# ── Application Load Balancer ─────────────────────────────────────────────────
resource "aws_lb" "api" {
  name               = "${local.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = module.vpc.public_subnet_ids

  enable_deletion_protection = false

  tags = { Name = "${local.name_prefix}-alb" }
}

# ── Target Group ──────────────────────────────────────────────────────────────
resource "aws_lb_target_group" "api" {
  name_prefix = "bpapi-" # max 6 chars; unique suffix avoids create_before_destroy collision
  port        = 5000
  protocol    = "HTTP"
  vpc_id      = module.vpc.vpc_id
  target_type = "ip" # required for Fargate

  deregistration_delay = 30

  health_check {
    path                = "/health"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }

  tags = { Name = "${local.name_prefix}-api-tg" }

  # Create new TG before destroying old one so the listener can swap
  # without a ResourceInUse error from AWS.
  lifecycle {
    create_before_destroy = true
  }
}

# ── Target Group: web (nginx serving the SPA; edge_mode = alb_https) ─────────
resource "aws_lb_target_group" "web" {
  count = local.https ? 1 : 0

  name_prefix          = "bpweb-"
  port                 = 8080
  protocol             = "HTTP"
  vpc_id               = module.vpc.vpc_id
  target_type          = "ip"
  deregistration_delay = 30

  health_check {
    path                = "/"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }

  tags = { Name = "${local.name_prefix}-web-tg" }

  lifecycle {
    create_before_destroy = true
  }
}

# ── HTTP Listener ─────────────────────────────────────────────────────────────
# With HTTPS on, port 80 only redirects. Otherwise it forwards to the api as before.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = local.https ? "redirect" : "forward"
    target_group_arn = local.https ? null : aws_lb_target_group.api.arn

    dynamic "redirect" {
      for_each = local.https ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
}

# ── HTTPS Listener ────────────────────────────────────────────────────────────
resource "aws_lb_listener" "https" {
  count = local.https ? 1 : 0

  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = data.terraform_remote_state.persistent.outputs.app_certificate_arn

  # Anything that is not an API path is the SPA.
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web[0].arn
  }

  lifecycle {
    precondition {
      condition     = var.domain_name != "" && var.web_image_tag != ""
      error_message = "edge_mode = alb_https requires domain_name and web_image_tag"
    }
  }
}

resource "aws_lb_listener_rule" "api_paths" {
  count = local.https ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    path_pattern {
      values = ["/auth/*", "/blogs", "/blogs/*"]
    }
  }
}

resource "aws_lb_listener_rule" "api_system" {
  count = local.https ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    path_pattern {
      values = ["/socket.io/*", "/health", "/ready"]
    }
  }
}

# ── DNS: app.<domain> -> ALB ──────────────────────────────────────────────────
resource "aws_route53_record" "app" {
  count = local.https ? 1 : 0

  zone_id = data.terraform_remote_state.persistent.outputs.hosted_zone_id
  name    = "app.${var.domain_name}"
  type    = "A"

  alias {
    name                   = aws_lb.api.dns_name
    zone_id                = aws_lb.api.zone_id
    evaluate_target_health = true
  }
}
