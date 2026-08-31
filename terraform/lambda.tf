resource "aws_cloudwatch_log_group" "chat" {
  name              = "/aws/lambda/rr-djuikoo-chat"
  retention_in_days = 7
}

data "archive_file" "chat" {
  type        = "zip"
  source_dir  = "${path.module}/../agent"
  output_path = "${path.module}/../agent.zip"
  excludes    = ["node_modules"]
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

  s3_bucket         = aws_s3_bucket.lambda_artifacts.id
  s3_key            = aws_s3_object.chat_artifact.key
  source_code_hash  = data.archive_file.chat.output_base64sha256
  s3_object_version = aws_s3_object.chat_artifact.version_id

  environment {
    variables = {
      SESSIONS_TABLE   = var.sessions_table_name
      BEDROCK_MODEL_ID = var.bedrock_model_id
    }
  }

  depends_on = [aws_cloudwatch_log_group.chat]
}

resource "aws_lambda_function_url" "chat" {
  function_name      = aws_lambda_function.chat.function_name
  authorization_type = "NONE"
  invoke_mode        = "RESPONSE_STREAM"

  cors {
    allow_origins = ["https://rr-djuikoo.com", "http://localhost:8000"]
    allow_methods = ["POST"]
    allow_headers = ["content-type"]
  }
}

resource "aws_lambda_permission" "chat_url" {
  statement_id           = "AllowPublicFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.chat.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "chat_invoke_via_url" {
  statement_id             = "AllowInvokeViaFunctionUrl"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.chat.function_name
  principal                = "*"
  invoked_via_function_url = true
}
