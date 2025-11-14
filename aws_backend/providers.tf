terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    bucket = "built-tf-state"      # S3 bucket where the state file will be stored
    key    = "eoh/terraform.tfstate" # Path within the S3 bucket
    region = "us-east-1"         # AWS region for the S3 bucket
  }
}

# Configure the AWS Provider
provider "aws" {
  region = "us-east-1"
}

data "aws_caller_identity" "current" {}