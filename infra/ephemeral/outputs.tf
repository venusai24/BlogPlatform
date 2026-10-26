# ── Networking ────────────────────────────────────────────────────────────────
output "alb_dns_name" {
  description = "DNS name of the public Application Load Balancer"
  value       = aws_lb.api.dns_name
}

output "alb_zone_id" {
  description = "Hosted zone ID of the ALB (for Route53 alias records)"
  value       = aws_lb.api.zone_id
}

# ── ECS ───────────────────────────────────────────────────────────────────────
output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.this.name
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN"
  value       = aws_ecs_cluster.this.arn
}

output "api_service_name" {
  description = "ECS service name for the API"
  value       = aws_ecs_service.api.name
}

# ── Networking helpers ────────────────────────────────────────────────────────
output "nat_public_ips" {
  description = "Public NAT addresses in use - both must be in the MongoDB Atlas IP access list (stable across sessions)"
  value       = slice(data.terraform_remote_state.persistent.outputs.nat_eip_public_ips, 0, local.nat_gateway_count)
}

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

# ── Domain events (null unless enable_domain_events) ──────────────────────────
output "domain_events_topic_arn" {
  description = "ARN of the domain-events SNS topic"
  value       = try(aws_sns_topic.domain_events[0].arn, null)
}

output "indexing_queue_url" {
  description = "URL of the indexing SQS queue"
  value       = try(aws_sqs_queue.indexing[0].url, null)
}

# ── Frontend ──────────────────────────────────────────────────────────────────
output "frontend_bucket_name" {
  description = "S3 bucket name for the frontend (null when nginx serves the SPA)"
  value       = try(aws_s3_bucket.frontend[0].bucket, null)
}

output "frontend_website_url" {
  description = "S3 Static Website URL (null when nginx serves the SPA)"
  value       = try(aws_s3_bucket_website_configuration.frontend[0].website_endpoint, null)
}

output "app_url" {
  description = "Where the app is served from"
  value       = local.https ? "https://app.${var.domain_name}" : "http://${aws_lb.api.dns_name}"
}

# ── Session tooling (scripts/session) ─────────────────────────────────────────
output "private_subnet_ids" {
  description = "Private subnets, for one-off ECS tasks such as the reconciliation dry run"
  value       = module.vpc.private_subnet_ids
}

output "worker_security_group_id" {
  description = "Security group of the worker service (null when the worker service is off)"
  value       = try(aws_security_group.worker[0].id, null)
}

output "api_url" {
  description = "Base URL of the API (the same host as the app when the SPA is served by the ALB)"
  value       = local.https ? "https://app.${var.domain_name}" : "http://${aws_lb.api.dns_name}"
}
