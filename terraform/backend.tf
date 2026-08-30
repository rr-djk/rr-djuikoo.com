# State locking via the native S3 lockfile (use_lockfile).
terraform {
  backend "s3" {
    bucket       = "rr-djuikoo-tf-state"
    key          = "site/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}
