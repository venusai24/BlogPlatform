# ── VPC ──────────────────────────────────────────────────────────────────────
module "vpc" {
  source   = "../modules/vpc"
  project  = var.project
  env      = var.env
  vpc_cidr = "10.0.0.0/16"
  region   = var.region

  # One NAT per AZ in HA mode. The addresses are owned by the persistent stack and stay stable, so
  # the MongoDB Atlas allow-list only needs them once.
  nat_gateway_count      = local.nat_gateway_count
  nat_eip_allocation_ids = data.terraform_remote_state.persistent.outputs.nat_eip_allocation_ids
}
