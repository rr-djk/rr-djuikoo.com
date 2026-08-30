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
