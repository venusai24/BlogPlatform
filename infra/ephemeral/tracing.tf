# Tracing (enable_tracing): the app exports OpenTelemetry spans to a collector sidecar on
# localhost:4318 (awsvpc tasks share a network namespace), which forwards them to X-Ray.
# The sidecar is non-essential: a collector failure must not take the api or worker down.

locals {
  # Pinned to a release (newest at implementation time; also on ECR Public). Bump deliberately.
  otel_collector_image = "public.ecr.aws/aws-observability/aws-otel-collector:v0.50.0"

  otel_collector_base = {
    name              = "otel-collector"
    image             = local.otel_collector_image
    essential         = false
    cpu               = 64
    memoryReservation = 128
    # The image's default ECS config receives OTLP and exports to X-Ray.
    command = ["--config=/etc/ecs/ecs-default-config.yaml"]
  }
}
