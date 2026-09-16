# Cost visibility for the Wags chat agent: a CloudWatch dashboard over the native
# Bedrock metrics plus the per-answer usage lines the Lambda writes, and a monthly
# budget on Bedrock spend.

resource "aws_cloudwatch_dashboard" "bedrock_cost" {
  dashboard_name = "rr-djuikoo-bedrock-cost"
  dashboard_body = jsonencode({
    start          = "-P7D"
    periodOverride = "inherit"

    widgets = [
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 2
        properties = {
          markdown = "## Dépense Bedrock : Wags (Aucun prix n'est stocké ici)."
        }
      },

      # Input/Output tokens split due to different rates (output costs more).
      # Uses Sum, not Average, to match actual invoice lines.
      # 1-hour period prevents sparse/empty data points at current traffic levels.
      {
        type   = "metric"
        x      = 0
        y      = 2
        width  = 12
        height = 6
        properties = {
          title  = "Tokens Bedrock (somme par heure)"
          view   = "timeSeries"
          region = var.aws_region
          period = 3600
          stat   = "Sum"
          metrics = [
            ["AWS/Bedrock", "InputTokenCount", "ModelId", var.bedrock_model_id],
            ["AWS/Bedrock", "OutputTokenCount", "ModelId", var.bedrock_model_id],
          ]
        }
      },

      # Invocations separates traffic spikes from longer responses.
      # Throttles show blocked users (invisible on token curves).
      # The two error metrics isolate our bugs from Bedrock outages without opening logs.
      {
        type   = "metric"
        x      = 12
        y      = 2
        width  = 12
        height = 6
        properties = {
          title  = "Appels, throttles et erreurs"
          view   = "timeSeries"
          region = var.aws_region
          period = 3600
          stat   = "Sum"
          metrics = [
            ["AWS/Bedrock", "Invocations", "ModelId", var.bedrock_model_id],
            ["AWS/Bedrock", "InvocationThrottles", "ModelId", var.bedrock_model_id],
            ["AWS/Bedrock", "InvocationClientErrors", "ModelId", var.bedrock_model_id],
            ["AWS/Bedrock", "InvocationServerErrors", "ModelId", var.bedrock_model_id],
          ]
        }
      },

      # Only widget linking spend to a single session (others are global aggregates).
      # Reads chat.usage logs from agent/usage.mjs.
      # Exact equality 'filter event = ...' speeds up queries using field indexing.
      # Split by agent: one exchange now emits one line per agent that ran, so the
      # gatekeeper's share of a conversation is readable next to the orchestrator's.
      # Limit raised accordingly, to keep covering roughly as many sessions as before.
      {
        type   = "log"
        x      = 0
        y      = 8
        width  = 24
        height = 8
        properties = {
          title  = "Tokens par conversation et par agent"
          view   = "table"
          region = var.aws_region
          query  = <<-EOT
            SOURCE '${aws_cloudwatch_log_group.chat.name}'
            | filter event = "chat.usage"
            | stats sum(inputTokens) as tokensEntree,
                    sum(outputTokens) as tokensSortie,
                    sum(cycles) as tours,
                    count(*) as appels
              by sessionId, agent
            | sort tokensSortie desc
            | limit 40
          EOT
        }
      },
    ]
  })
}

# Alert-only (free, no auto-shutdown). Real-time guardrails remain maxTokens
# in the agent, Lambda concurrency, and IP rate limits.
resource "aws_budgets_budget" "bedrock" {
  name         = "rr-djuikoo-bedrock-monthly"
  budget_type  = "COST"
  limit_amount = "20"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "Service"
    values = ["Amazon Bedrock"]
  }

  notification {
    notification_type          = "ACTUAL"
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = [var.budget_alert_email]
  }

  notification {
    notification_type          = "FORECASTED"
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = [var.budget_alert_email]
  }
}

# Alerting path for the alarm below. Deliberately unencrypted: a topic encrypted
# with the AWS managed key alias/aws/sns cannot be published to by a CloudWatch
# alarm, that key's policy not naming cloudwatch.amazonaws.com. The alarm would
# fire and the mail would never leave. The message carries an alarm name and a
# token count, nothing else. Skipped in .checkov.yml: CKV_AWS_26.
resource "aws_sns_topic" "bedrock_alerts" {
  name = "rr-djuikoo-bedrock-alerts"
}

# Created as "pending confirmation": the link in the first mail has to be clicked
# before anything is delivered.
resource "aws_sns_topic_subscription" "bedrock_alerts_email" {
  topic_arn = aws_sns_topic.bedrock_alerts.arn
  protocol  = "email"
  endpoint  = var.budget_alert_email
}

# Grants CloudWatch the right to publish, rather than relying on the default topic
# policy: whether that default lets an alarm through only shows on a real trigger,
# and an alarm whose mail never leaves is worth nothing. Scoped to this alarm and
# this account, so no other alarm, here or elsewhere, can post into the topic.
data "aws_iam_policy_document" "bedrock_alerts" {
  statement {
    sid    = "AllowThisAlarmToPublish"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }

    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.bedrock_alerts.arn]

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_metric_alarm.bedrock_input_tokens.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "bedrock_alerts" {
  arn    = aws_sns_topic.bedrock_alerts.arn
  policy = data.aws_iam_policy_document.bedrock_alerts.json
}

# The budget above reads billing data that lands hours late. Token counts publish
# within minutes, so this catches an inflated conversation while it is running.
# The threshold started at 25000, below a single legitimate question: one code
# explorer run on MyAm measured 45841 input tokens, its tool results replayed on
# every round trip. 200000 leaves room for a few such questions in the same five
# minutes and still catches a sustained abuse. Most slices are empty at current
# traffic, hence notBreaching.
#
# One breaching period out of one, on purpose. The usual advice is M out of N, so
# that a lone spike on an error or latency metric is not paged as an incident.
# Here a single 5-minute slice at this level is money already spent.
resource "aws_cloudwatch_metric_alarm" "bedrock_input_tokens" {
  alarm_name        = "rr-djuikoo-bedrock-input-tokens"
  alarm_description = "Bedrock input tokens above 200000 in 5 minutes: possible cost amplification on /api/chat."

  namespace   = "AWS/Bedrock"
  metric_name = "InputTokenCount"
  dimensions  = { ModelId = var.bedrock_model_id }

  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 200000
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.bedrock_alerts.arn]
}
