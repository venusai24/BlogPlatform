# DNS and TLS for the app. Everything here is skipped while domain_name is empty, so the persistent
# stack still applies before a domain exists. The outputs fall back to null for the same reason.

locals {
  has_domain = var.domain_name != ""
}

data "aws_route53_zone" "this" {
  count = local.has_domain ? 1 : 0

  name = var.domain_name
}

resource "aws_acm_certificate" "app" {
  count = local.has_domain ? 1 : 0

  domain_name       = "app.${var.domain_name}"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# A single-name certificate has exactly one validation option. The for_each key is static so the plan
# never depends on values only known after the certificate exists.
resource "aws_route53_record" "app_validation" {
  for_each = local.has_domain ? toset(["app"]) : toset([])

  allow_overwrite = true
  name            = tolist(aws_acm_certificate.app[0].domain_validation_options)[0].resource_record_name
  records         = [tolist(aws_acm_certificate.app[0].domain_validation_options)[0].resource_record_value]
  ttl             = 60
  type            = tolist(aws_acm_certificate.app[0].domain_validation_options)[0].resource_record_type
  zone_id         = data.aws_route53_zone.this[0].zone_id
}

resource "aws_acm_certificate_validation" "app" {
  count = local.has_domain ? 1 : 0

  certificate_arn         = aws_acm_certificate.app[0].arn
  validation_record_fqdns = [for record in aws_route53_record.app_validation : record.fqdn]
}

# Read by the ephemeral stack. try() keeps these resolvable (as null) when there is no domain.
output "app_certificate_arn" {
  description = "ARN of the validated ACM certificate for app.<domain>"
  value       = try(aws_acm_certificate_validation.app[0].certificate_arn, null)
}

output "hosted_zone_id" {
  description = "Route 53 hosted zone ID of the domain"
  value       = try(data.aws_route53_zone.this[0].zone_id, null)
}

output "app_fqdn" {
  description = "Fully qualified name the app is served from"
  value       = local.has_domain ? "app.${var.domain_name}" : null
}
