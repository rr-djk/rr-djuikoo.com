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
      # Reads chat.usage logs from agent.mjs (stays empty until code is deployed).
      # Exact equality 'filter event = ...' speeds up queries using field indexing.
      {
        type   = "log"
        x      = 0
        y      = 8
        width  = 24
        height = 8
        properties = {
          title  = "Tokens par conversation"
          view   = "table"
          region = var.aws_region
          query  = <<-EOT
            SOURCE '${aws_cloudwatch_log_group.chat.name}'
            | filter event = "chat.usage"
            | stats sum(inputTokens) as tokensEntree,
                    sum(outputTokens) as tokensSortie,
                    sum(cycles) as tours,
                    count(*) as reponses
              by sessionId
            | sort tokensSortie desc
            | limit 20
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
