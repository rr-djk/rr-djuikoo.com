provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = "rr-djuikoo.com"
      ManagedBy = "terraform"
    }
  }
}
