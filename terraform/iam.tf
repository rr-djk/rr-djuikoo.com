data "aws_caller_identity" "current" {}

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

locals {
  bedrock_foundation_model      = trimprefix(var.bedrock_model_id, "global.")
  bedrock_inference_profile_arn = "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:inference-profile/${var.bedrock_model_id}"
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

  # Global cross-region inference needs three distinct resources: the inference
  # profile in the requesting region, the regional foundation model, and the
  # global foundation model that makes the cross-region routing possible. The
  # "global." prefix belongs to the profile only, never to a foundation model.
  statement {
    sid    = "InvokeBedrockInferenceProfile"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = [local.bedrock_inference_profile_arn]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [var.aws_region]
    }
  }

  statement {
    sid    = "InvokeBedrockRegionalModel"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = ["arn:aws:bedrock:${var.aws_region}::foundation-model/${local.bedrock_foundation_model}"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [var.aws_region]
    }

    condition {
      test     = "StringEquals"
      variable = "bedrock:InferenceProfileArn"
      values   = [local.bedrock_inference_profile_arn]
    }
  }

  statement {
    sid    = "InvokeBedrockGlobalModel"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = ["arn:aws:bedrock:::foundation-model/${local.bedrock_foundation_model}"]

    # The global resource carries no region, so the request reports "unspecified".
    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = ["unspecified"]
    }

    condition {
      test     = "StringEquals"
      variable = "bedrock:InferenceProfileArn"
      values   = [local.bedrock_inference_profile_arn]
    }
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
