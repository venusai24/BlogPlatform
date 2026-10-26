#!/usr/bin/env bash
# End a session: destroy the ephemeral layer. The persistent layer (ECR, secrets, DNS, the vector index,
# the NAT addresses) stays.
#
#   make down
#
#   STATE_BUCKET     the Terraform state bucket, if it is not already in terraform.tfvars
#   AUTO_APPROVE=1   pass -auto-approve (otherwise Terraform asks)
#
# Afterwards it runs status.sh and expects nothing to be left. Run by you, not by automation.
set -euo pipefail

cd "$(dirname "$0")/../.."

APPROVE=()
[ "${AUTO_APPROVE:-0}" = 1 ] && APPROVE=(-auto-approve)
STATE_ARGS=()
[ -n "${STATE_BUCKET:-}" ] && STATE_ARGS=(-var "state_bucket=$STATE_BUCKET")

terraform -chdir=infra/ephemeral destroy "${APPROVE[@]}" "${STATE_ARGS[@]}"

echo "==> checking that nothing is left"
scripts/session/status.sh
