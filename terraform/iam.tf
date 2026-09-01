data "aws_iam_policy_document" "lambda_assume" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "chat" {
  name               = "rr-djuikoo-chat"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "chat" {
  statement {
    sid    = "WriteLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:${var.aws_region}:*:log-group:/aws/lambda/rr-djuikoo-chat*"]
  }

  statement {
    sid    = "AccessSessionsTable"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
    ]
    resources = [aws_dynamodb_table.sessions.arn]
  }

  statement {
    sid    = "AccessRateLimitTable"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
    ]
    resources = [aws_dynamodb_table.rate_limit.arn]
  }

  statement {
    sid    = "InvokeBedrock"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = ["arn:aws:bedrock:us-east-1::foundation-model/global.anthropic.claude-haiku-4-5-20251001-v1:0"]
  }
}

resource "aws_iam_role_policy" "chat" {
  name   = "rr-djuikoo-chat"
  role   = aws_iam_role.chat.id
  policy = data.aws_iam_policy_document.chat.json
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}


# Role assumed by GitHub Actions via OIDC
resource "aws_iam_role" "deploy_site" {
  name = "rr-djuikoo-deploy-site"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      # The deploy job declares `environment: production`, so GitHub always issues
      # a sub of the form `repo:...:environment:production`. Restricting to that
      # single subject prevents a future workflow on main, with no environment
      # declared, from assuming the role and bypassing the environment approval.
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:rr-djk/rr-djuikoo.com:environment:production"
        }
      }
    }]
  })
}

# Least-privilege IAM policy for site deployment
resource "aws_iam_role_policy" "deploy_site" {
  name = "rr-djuikoo-deploy-site"
  role = aws_iam_role.deploy_site.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "ListSiteBucket", Effect = "Allow", Action = ["s3:ListBucket"], Resource = [aws_s3_bucket.site.arn] },
      { Sid = "WriteSiteObjects", Effect = "Allow", Action = ["s3:PutObject", "s3:DeleteObject"], Resource = ["${aws_s3_bucket.site.arn}/*"] },
      { Sid = "CreateInvalidation", Effect = "Allow", Action = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"], Resource = [aws_cloudfront_distribution.main.arn] },
    ]
  })
}
