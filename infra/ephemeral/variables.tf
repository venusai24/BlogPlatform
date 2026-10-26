variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "env" {
  type    = string
  default = "prod"
}

variable "project" {
  type    = string
  default = "blogplatform"
}

variable "state_bucket" {
  type        = string
  description = "Name of the S3 bucket holding Terraform state"
}

variable "api_image_tag" {
  type        = string
  default     = "latest"
  description = "Docker image tag to deploy on the API ECS service"
}

variable "api_cpu" {
  type    = number
  default = 512
}

variable "api_memory" {
  type    = number
  default = 1024
}

variable "ha_mode" {
  type        = bool
  default     = false
  description = "Spread across two AZs: a NAT gateway per AZ, two api/worker/web tasks, and a Valkey replica with automatic failover"
}
variable "enable_worker_service" {
  type        = bool
  default     = false
  description = "Run the BullMQ workers as a separate Fargate Spot service instead of inside the API"
}

variable "worker_cpu" {
  type    = number
  default = 256
}

variable "worker_memory" {
  type    = number
  default = 512
}

variable "enable_domain_events" {
  type        = bool
  default     = false
  description = "Create the domain-events SNS topic and the indexing SQS queue + DLQ (requires enable_worker_service)"
}

variable "indexing_backend" {
  type        = string
  default     = "bullmq"
  description = "How post writes reach the indexer: bullmq (job queue), events (outbox), or both"

  validation {
    condition     = contains(["bullmq", "both", "events"], var.indexing_backend)
    error_message = "indexing_backend must be one of bullmq, both, events."
  }
}

variable "indexing_consumer_mode" {
  type        = string
  default     = "off"
  description = "Indexing SQS consumer: off, shadow (read-only comparison) or active"

  validation {
    condition     = contains(["off", "shadow", "active"], var.indexing_consumer_mode)
    error_message = "indexing_consumer_mode must be one of off, shadow, active."
  }
}

variable "reconcile_interval_ms" {
  type        = string
  default     = "0"
  description = "How often the worker runs the reconciliation sweep, in ms. 0 turns it off."
}

variable "reconcile_dry_run" {
  type        = string
  default     = "true"
  description = "When \"true\" the sweep only counts drift; set \"false\" to repair it."
}

variable "edge_mode" {
  type        = string
  default     = "alb_http"
  description = "How traffic reaches the app: alb_http (legacy, S3 website + plain-HTTP ALB), alb_https (custom domain, TLS on the ALB, nginx web service) or cloudfront"

  validation {
    condition     = contains(["alb_http", "alb_https", "cloudfront"], var.edge_mode)
    error_message = "edge_mode must be one of alb_http, alb_https, cloudfront."
  }
}

variable "domain_name" {
  type        = string
  default     = ""
  description = "Registered domain; the app is served from app.<domain_name> (edge_mode = alb_https)"
}

variable "web_image_tag" {
  type        = string
  default     = ""
  description = "Tag (git SHA) of the blogplatform-web image to run (edge_mode = alb_https)"
}

variable "redis_mode" {
  type        = string
  default     = "fargate"
  description = "Where Redis runs: fargate (a container on EFS) or elasticache (managed Valkey)"

  validation {
    condition     = contains(["fargate", "elasticache"], var.redis_mode)
    error_message = "redis_mode must be one of fargate, elasticache."
  }
}

variable "vector_store" {
  type        = string
  default     = "qdrant"
  description = "Which vector store serves searches: qdrant or s3vectors"

  validation {
    condition     = contains(["qdrant", "s3vectors"], var.vector_store)
    error_message = "vector_store must be one of qdrant, s3vectors."
  }
}

variable "vector_store_write" {
  type        = string
  default     = "primary"
  description = "primary writes only to vector_store; both also fills Qdrant and S3 Vectors during a migration"

  validation {
    condition     = contains(["primary", "both"], var.vector_store_write)
    error_message = "vector_store_write must be one of primary, both."
  }
}

variable "indexing_consumer_runtime" {
  type        = string
  default     = "ecs"
  description = "What consumes the indexing queue: ecs (the worker service) or lambda (an SQS-triggered function)"

  validation {
    condition     = contains(["ecs", "lambda"], var.indexing_consumer_runtime)
    error_message = "indexing_consumer_runtime must be one of ecs, lambda."
  }
}

variable "lambda_image_tag" {
  type        = string
  default     = ""
  description = "Tag of the Lambda image in the blogplatform-api repository (the <git sha>-lambda tag CI pushes); required when indexing_consumer_runtime = lambda"
}

variable "enable_tracing" {
  type        = bool
  default     = false
  description = "Trace requests through the async path: OpenTelemetry in the app plus a collector sidecar that forwards to X-Ray"
}

variable "enable_waf" {
  type        = bool
  default     = false
  description = "Put an AWS WAF web ACL (rate limit plus AWS managed rules) in front of the app"
}

# ── Fault injection (resilience experiments) ─────────────────────────────────
# Off by default. In production the app ignores the three settings below unless
# fault_injection_enabled is true, so they cannot be left on by accident.
variable "fault_injection_enabled" {
  type        = bool
  default     = false
  description = "Allow the fault settings below to take effect in production"
}

variable "fault_embed_error_rate" {
  type        = string
  default     = "0"
  description = "Share (0-1) of embedding calls that fail like Bedrock throttling"

  validation {
    condition     = try(tonumber(var.fault_embed_error_rate) >= 0 && tonumber(var.fault_embed_error_rate) <= 1, false)
    error_message = "fault_embed_error_rate must be a number between 0 and 1."
  }
}

variable "fault_llm_error_rate" {
  type        = string
  default     = "0"
  description = "Share (0-1) of LLM calls that fail"

  validation {
    condition     = try(tonumber(var.fault_llm_error_rate) >= 0 && tonumber(var.fault_llm_error_rate) <= 1, false)
    error_message = "fault_llm_error_rate must be a number between 0 and 1."
  }
}

variable "fault_relay_pause" {
  type        = bool
  default     = false
  description = "Stop the outbox relay claiming records, so the backlog builds up"
}

variable "rate_limit_enabled" {
  type        = bool
  default     = true
  description = "The API's per-IP rate limiters. Turn off only for load tests, which all come from one IP"
}

variable "session_started_at" {
  type        = string
  default     = "unset"
  description = "UTC start time of this session (set by scripts/session/up.sh); becomes the Session tag on every resource"
}

variable "auth_provider" {
  type        = string
  default     = "app"
  description = "Who signs users in: app (the API issues its own JWTs) or cognito (Amazon Cognito; the API only verifies tokens)"

  validation {
    condition     = contains(["app", "cognito"], var.auth_provider)
    error_message = "auth_provider must be one of app, cognito."
  }
}
