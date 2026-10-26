mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
}

variables {
  github_repo  = "venusai24/BlogPlatform"
  budget_email = "ops@example.com"
  alert_email  = "ops@example.com"
}

run "two_stable_nat_addresses" {
  command = plan

  assert {
    condition     = length(aws_eip.nat) == 2
    error_message = "one Elastic IP per NAT gateway, so the Atlas allowlist is stable across sessions"
  }
  assert {
    condition     = alltrue([for e in aws_eip.nat : e.domain == "vpc"])
    error_message = "VPC addresses"
  }
  assert {
    condition     = [for e in aws_eip.nat : e.tags["Name"]] == ["blogplatform-prod-nat-0", "blogplatform-prod-nat-1"]
    error_message = "names identify which NAT each address belongs to"
  }
}

run "eip_outputs" {
  command = plan

  assert {
    condition     = length(output.nat_eip_allocation_ids) == 2 && length(output.nat_eip_public_ips) == 2
    error_message = "the ephemeral stack reads both allocation ids and public IPs"
  }
}
