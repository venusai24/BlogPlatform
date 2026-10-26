# ── EFS Security Group ───────────────────────────────────────────────────────
resource "aws_security_group" "efs" {
  name        = "${local.name_prefix}-efs-sg"
  description = "Allow NFS traffic from internal services"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "NFS from internal services"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.internal.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name_prefix}-efs-sg" }
}

# ── EFS: Qdrant ──────────────────────────────────────────────────────────────
resource "aws_efs_file_system" "qdrant" {
  creation_token = "${local.name_prefix}-qdrant-efs"
  encrypted      = true

  tags = { Name = "${local.name_prefix}-qdrant-efs" }
}

resource "aws_efs_mount_target" "qdrant" {
  count           = length(module.vpc.private_subnet_ids)
  file_system_id  = aws_efs_file_system.qdrant.id
  subnet_id       = module.vpc.private_subnet_ids[count.index]
  security_groups = [aws_security_group.efs.id]
}

# ── EFS: Redis ───────────────────────────────────────────────────────────────
resource "aws_efs_file_system" "redis" {
  count = var.redis_mode == "fargate" ? 1 : 0

  creation_token = "${local.name_prefix}-redis-efs"
  encrypted      = true

  tags = { Name = "${local.name_prefix}-redis-efs" }
}

resource "aws_efs_mount_target" "redis" {
  count           = var.redis_mode == "fargate" ? length(module.vpc.private_subnet_ids) : 0
  file_system_id  = aws_efs_file_system.redis[0].id
  subnet_id       = module.vpc.private_subnet_ids[count.index]
  security_groups = [aws_security_group.efs.id]
}
