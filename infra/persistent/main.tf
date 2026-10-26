terraform {
  backend "s3" {
    # Specify the bucket name via CLI or backend config file
    # bucket = "my-unique-bucket-name"
    key          = "persistent/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true
  }
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
  required_version = ">= 1.10.0"
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project = "blogplatform"
      Env     = var.env
      Layer   = "persistent"
    }
  }
}

variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "env" {
  type    = string
  default = "prod"
}

variable "github_repo" {
  type        = string
  description = "GitHub repository string (e.g., username/repo)"
}

variable "github_repo_id_subject" {
  type        = string
  default     = null
  description = "The repository as GitHub writes it in OIDC tokens that carry immutable ids, <owner>@<owner id>/<repo>@<repo id>. Set it when CI is refused with \"Not authorized to perform sts:AssumeRoleWithWebIdentity\"; CloudTrail's AssumeRoleWithWebIdentity event shows the value."

  validation {
    condition     = var.github_repo_id_subject == null || can(regex("^[^/@]+@[0-9]+/[^/@]+@[0-9]+$", var.github_repo_id_subject))
    error_message = "github_repo_id_subject must look like owner@123/repo@456."
  }
}

variable "alert_email" {
  type        = string
  description = "Email address for operational alerts (CloudWatch alarms and job-failure notifications)"
}

variable "domain_name" {
  type        = string
  default     = ""
  description = "Registered Route 53 domain (e.g. example.click). Leave empty until one exists: no DNS or certificate resources are created."
}
