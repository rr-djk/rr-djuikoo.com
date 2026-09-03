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

  # Portfolio content ships with the static site rather than with the Lambda
  # package, so the agent reads it back from the site bucket. Scoped to that one
  # object, not to the bucket.
  statement {
    sid    = "ReadSiteContent"
    effect = "Allow"
    actions = [
      "s3:GetObject",
    ]
    resources = ["${aws_s3_bucket.site.arn}/content.json"]
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
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = [
            "repo:rr-djk/rr-djuikoo.com:environment:production",
            "repo:rr-djk@211054470/rr-djuikoo.com@1348058256:environment:production",
          ]
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
      # s3:GetObject is required by the post-deploy integrity check, which calls
      # s3api head-object to compare each ETag against the local MD5.
      { Sid = "WriteSiteObjects", Effect = "Allow", Action = ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"], Resource = ["${aws_s3_bucket.site.arn}/*"] },
      { Sid = "CreateInvalidation", Effect = "Allow", Action = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"], Resource = [aws_cloudfront_distribution.main.arn] },
    ]
  })
}
