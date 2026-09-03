resource "aws_cloudwatch_log_group" "chat" {
  name              = "/aws/lambda/rr-djuikoo-chat"
  retention_in_days = 7
}

# node_modules ships with the package on purpose: the nodejs22.x runtime does not
# provide @strands-agents/sdk or zod, and nothing else installs them at deploy
# time. A missing or stale tree would still zip cleanly and only surface as a
# Runtime.ImportModuleError in production, so the precondition below refuses to
# build the archive instead. Use `make plan`, which installs first. Only the .bin
# symlinks are left out, since the handler never invokes them.
data "archive_file" "chat" {
  type        = "zip"
  source_dir  = "${path.module}/../agent"
  output_path = "${path.module}/../agent.zip"
  excludes    = ["node_modules/.bin"]

  lifecycle {
    precondition {
      # `make agent-deps` writes the stamp with the hash of the lockfile it
      # installed from, so a stale tree is caught as well as a missing one.
      # try() rather than fileexists() && file(): HCL does not guarantee
      # short-circuit evaluation, so the missing-file case must be caught here.
      condition     = try(trimspace(file("${path.module}/../agent/node_modules/.deps-stamp")), "") == filesha256("${path.module}/../agent/package-lock.json")
      error_message = "Dependances de l'agent absentes ou perimees: agent.zip partirait sans node_modules et la Lambda echouerait a l'init. Lance `make agent-deps` (ou `make plan`)."
    }
  }
}

resource "aws_s3_object" "chat_artifact" {
  bucket = aws_s3_bucket.lambda_artifacts.id
  key    = "agent.zip"
  source = data.archive_file.chat.output_path
  etag   = filemd5(data.archive_file.chat.output_path)
}

resource "aws_lambda_function" "chat" {
  function_name = "rr-djuikoo-chat"
  role          = aws_iam_role.chat.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  memory_size   = 512
  timeout       = 30

  reserved_concurrent_executions = 10

  s3_bucket         = aws_s3_bucket.lambda_artifacts.id
  s3_key            = aws_s3_object.chat_artifact.key
  source_code_hash  = data.archive_file.chat.output_base64sha256
  s3_object_version = aws_s3_object.chat_artifact.version_id

  environment {
    variables = {
      SESSIONS_TABLE   = var.sessions_table_name
      BEDROCK_MODEL_ID = var.bedrock_model_id
      RATE_LIMIT_TABLE = var.rate_limit_table_name
      CONTENT_BUCKET   = var.site_bucket_name
      CONTENT_KEY      = "content.json"
    }
  }

  depends_on = [aws_cloudwatch_log_group.chat]
}

resource "aws_lambda_function_url" "chat" {
  function_name      = aws_lambda_function.chat.function_name
  authorization_type = "AWS_IAM"
  invoke_mode        = "RESPONSE_STREAM"
}

resource "aws_lambda_permission" "chat_cloudfront" {
  statement_id           = "AllowCloudFrontInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.chat.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.main.arn
  function_url_auth_type = "AWS_IAM"
}
