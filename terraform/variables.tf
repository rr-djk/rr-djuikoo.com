variable "aws_region" {
  description = "AWS region for all resources in this stack."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Value of the Project tag applied to every resource."
  type        = string
  default     = "rr-djuikoo.com"
}

variable "site_bucket_name" {
  description = "Name of the S3 bucket that hosts the static site."
  type        = string
  default     = "rr-djuikoo-site"
}

variable "artifact_bucket_name" {
  description = "Name of the S3 bucket that stores Lambda deployment artefacts."
  type        = string
  default     = "rr-djuikoo-lambda-artifacts"
}

variable "sessions_table_name" {
  description = "Name of the DynamoDB table that stores chat sessions."
  type        = string
  default     = "rr-djuikoo-sessions"
}

variable "rate_limit_table_name" {
  description = "Name of the DynamoDB table used for chat rate limiting."
  type        = string
  default     = "rr-djuikoo-chat-rate-limit"
}

variable "bedrock_model_id" {
  description = "Bedrock foundation model ID for the chat agent."
  type        = string
  default     = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
}
