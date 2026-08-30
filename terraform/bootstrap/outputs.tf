output "state_bucket_id" {
  description = "Name of the S3 bucket holding Terraform remote state."
  value       = aws_s3_bucket.tf_state.id
}

output "state_bucket_arn" {
  description = "ARN of the S3 bucket holding Terraform remote state."
  value       = aws_s3_bucket.tf_state.arn
}
