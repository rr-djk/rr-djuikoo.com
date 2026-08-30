variable "aws_region" {
  description = "AWS region for the Terraform state bucket."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Value of the Project tag applied to every resource."
  type        = string
  default     = "rr-djuikoo.com"
}

variable "state_bucket_name" {
  description = "Name of the S3 bucket that stores Terraform remote state."
  type        = string
  default     = "rr-djuikoo-tf-state"
}
