variable "project" {
  type    = string
  default = "blogplatform"
}

variable "env" {
  type    = string
  default = "prod"
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "region" {
  type = string
}

variable "nat_gateway_count" {
  type        = number
  default     = 1
  description = "1 = a single NAT gateway shared by every AZ; 2 = one per AZ (HA)"

  validation {
    condition     = var.nat_gateway_count >= 1 && var.nat_gateway_count <= length(var.nat_eip_allocation_ids)
    error_message = "nat_gateway_count must be between 1 and the number of nat_eip_allocation_ids."
  }
}

variable "nat_eip_allocation_ids" {
  type        = list(string)
  description = "Elastic IP allocation ids for the NAT gateways (owned by the persistent stack so they stay stable)"
}

# ── Data ────────────────────────────────────────────────────────────────────
data "aws_availability_zones" "available" { state = "available" }

locals {
  az_count   = min(2, length(data.aws_availability_zones.available.names))
  azs        = slice(data.aws_availability_zones.available.names, 0, local.az_count)
  pub_cidrs  = [for i in range(local.az_count) : cidrsubnet(var.vpc_cidr, 8, i)]
  priv_cidrs = [for i in range(local.az_count) : cidrsubnet(var.vpc_cidr, 8, i + 10)]
}

# ── VPC ─────────────────────────────────────────────────────────────────────
resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${var.project}-${var.env}-vpc" }
}

# ── Internet Gateway ─────────────────────────────────────────────────────────
resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${var.project}-${var.env}-igw" }
}

# ── Public Subnets ───────────────────────────────────────────────────────────
resource "aws_subnet" "public" {
  count                   = local.az_count
  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.pub_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "${var.project}-${var.env}-public-${local.azs[count.index]}" }
}

# ── Private Subnets ──────────────────────────────────────────────────────────
resource "aws_subnet" "private" {
  count             = local.az_count
  vpc_id            = aws_vpc.this.id
  cidr_block        = local.priv_cidrs[count.index]
  availability_zone = local.azs[count.index]
  tags              = { Name = "${var.project}-${var.env}-private-${local.azs[count.index]}" }
}

# ── NAT Gateways ─────────────────────────────────────────────────────────────
# The Elastic IPs come from the persistent stack so the addresses survive teardown.
resource "aws_nat_gateway" "this" {
  count = var.nat_gateway_count

  allocation_id = var.nat_eip_allocation_ids[count.index]
  subnet_id     = aws_subnet.public[count.index].id
  tags          = { Name = "${var.project}-${var.env}-nat-${count.index}" }
  depends_on    = [aws_internet_gateway.this]

  lifecycle {
    precondition {
      condition     = var.nat_gateway_count <= local.az_count
      error_message = "nat_gateway_count cannot exceed the number of availability zones in use."
    }
  }
}

# ── Public Route Table ────────────────────────────────────────────────────────
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }
  tags = { Name = "${var.project}-${var.env}-public-rt" }
}

resource "aws_route_table_association" "public" {
  count          = local.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ── Private Route Tables (one per AZ) ────────────────────────────────────────
# With a single NAT every AZ routes through it; with two, each AZ uses its own, so losing one AZ
# does not cut off egress from the other.
resource "aws_route_table" "private" {
  count = local.az_count

  vpc_id = aws_vpc.this.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.this[min(count.index, var.nat_gateway_count - 1)].id
  }
  tags = { Name = "${var.project}-${var.env}-private-rt-${count.index}" }
}

resource "aws_route_table_association" "private" {
  count          = local.az_count
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# ── S3 Gateway Endpoint ───────────────────────────────────────────────────────
# ECR image layers are served from S3; this keeps that traffic off the NAT gateways (and its data charge).
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.this.id
  vpc_endpoint_type = "Gateway"
  service_name      = "com.amazonaws.${var.region}.s3"
  route_table_ids   = aws_route_table.private[*].id
  tags              = { Name = "${var.project}-${var.env}-s3-endpoint" }
}
