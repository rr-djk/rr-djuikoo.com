output "site_bucket_name" {
  description = "Name of the S3 bucket that hosts the static site."
  value       = aws_s3_bucket.site.id
}

output "artifact_bucket_name" {
  description = "Name of the S3 bucket that stores Lambda artefacts."
  value       = aws_s3_bucket.lambda_artifacts.id
}

output "sessions_table_name" {
  description = "Name of the DynamoDB sessions table."
  value       = aws_dynamodb_table.sessions.name
}

output "rate_limit_table_name" {
  description = "Name of the DynamoDB rate-limit table."
  value       = aws_dynamodb_table.rate_limit.name
}

output "chat_function_name" {
  description = "Name of the chat Lambda function."
  value       = aws_lambda_function.chat.function_name
}

output "chat_function_url" {
  description = "Function URL of the chat Lambda (RESPONSE_STREAM, auth IAM, CloudFront only)."
  value       = aws_lambda_function_url.chat.function_url
}

output "cloudfront_distribution_id" {
  description = "ID of the CloudFront distribution."
  value       = aws_cloudfront_distribution.main.id
}

output "cloudfront_domain_name" {
  description = "Domain name of the CloudFront distribution."
  value       = aws_cloudfront_distribution.main.domain_name
}

output "acm_certificate_arn" {
  description = "ARN of the ACM certificate for the site."
  value       = aws_acm_certificate.site.arn
}
