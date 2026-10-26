# Elastic IPs for the NAT gateways. They live here, not in the ephemeral stack, so the addresses stay
# the same from session to session: MongoDB Atlas only has to allow-list them once. Idle, each costs
# a public IPv4 charge (about $3.65 a month).
resource "aws_eip" "nat" {
  count = 2

  domain = "vpc"

  tags = {
    Name = "blogplatform-${var.env}-nat-${count.index}"
  }
}

output "nat_eip_allocation_ids" {
  description = "Allocation ids of the NAT gateway addresses (read by the ephemeral stack)"
  value       = aws_eip.nat[*].allocation_id
}

output "nat_eip_public_ips" {
  description = "Public NAT addresses: add these to the MongoDB Atlas IP access list"
  value       = aws_eip.nat[*].public_ip
}
