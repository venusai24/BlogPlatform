#!/usr/bin/env bash
# Start a session: apply the persistent layer, apply the ephemeral layer, wait until it is healthy, run a
# reconciliation dry run, and print the URL and the hourly cost.
#
#   IMAGE_TAG=<git sha> WEB_IMAGE_TAG=<git sha> make up
#
#   IMAGE_TAG        required. An api image tag that already exists in ECR (tags are immutable).
#   WEB_IMAGE_TAG    required when EDGE=alb_https (the default).
#   EDGE             alb_https (default) | alb_http | cloudfront
#   HA=1             two availability zones: NAT per AZ, two tasks, a Valkey replica
#   WORKER=0         skip the worker service (default: on)
#   STATE_BUCKET     the Terraform state bucket, if it is not already in terraform.tfvars
#   EXTRA_TF_ARGS    more `terraform apply` arguments for the ephemeral layer, e.g. "-var enable_waf=true"
#   AUTO_APPROVE=1   pass -auto-approve (otherwise Terraform asks for each apply)
#
# This applies infrastructure and starts hourly billing. It is meant to be run by you, not by automation.
set -euo pipefail

cd "$(dirname "$0")/../.."

: "${IMAGE_TAG:?IMAGE_TAG is required: an existing api image tag (git sha) in ECR}"
EDGE="${EDGE:-alb_https}"
case "$EDGE" in
  alb_https|alb_http|cloudfront) ;;
  *) echo "EDGE must be alb_https, alb_http or cloudfront (got: $EDGE)" >&2; exit 1 ;;
esac
if [ "$EDGE" = "alb_https" ] && [ -z "${WEB_IMAGE_TAG:-}" ]; then
  echo "WEB_IMAGE_TAG is required when EDGE=alb_https (an existing web image tag in ECR)" >&2
  exit 1
fi

REGION="${AWS_REGION:-ap-south-1}"
CLUSTER="blogplatform-prod-cluster"
APPROVE=()
[ "${AUTO_APPROVE:-0}" = 1 ] && APPROVE=(-auto-approve)
STATE_ARGS=()
[ -n "${STATE_BUCKET:-}" ] && STATE_ARGS=(-var "state_bucket=$STATE_BUCKET")
HA_VALUE=false;     [ "${HA:-0}" = 1 ] && HA_VALUE=true
WORKER_VALUE=true;  [ "${WORKER:-1}" = 0 ] && WORKER_VALUE=false
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "==> 1/5 persistent layer"
terraform -chdir=infra/persistent apply "${APPROVE[@]}"

echo "==> 2/5 ephemeral layer (session started $STARTED_AT)"
# shellcheck disable=SC2086
terraform -chdir=infra/ephemeral apply "${APPROVE[@]}" "${STATE_ARGS[@]}" \
  -var "api_image_tag=$IMAGE_TAG" \
  -var "ha_mode=$HA_VALUE" \
  -var "edge_mode=$EDGE" \
  -var "web_image_tag=${WEB_IMAGE_TAG:-}" \
  -var "enable_worker_service=$WORKER_VALUE" \
  -var "session_started_at=$STARTED_AT" \
  ${EXTRA_TF_ARGS:-}

echo "==> 3/5 waiting for the services to become stable"
SERVICES=(blogplatform-prod-api)
[ "$WORKER_VALUE" = true ] && SERVICES+=(blogplatform-prod-worker)
[ "$EDGE" = alb_https ] && SERVICES+=(blogplatform-prod-web)
aws ecs wait services-stable --region "$REGION" --cluster "$CLUSTER" --services "${SERVICES[@]}"

if [ "$WORKER_VALUE" = true ]; then
  echo "==> 4/5 reconciliation dry run (counts drift, changes nothing)"
  SUBNETS="$(terraform -chdir=infra/ephemeral output -json private_subnet_ids | tr -d '[]" ')"
  WORKER_SG="$(terraform -chdir=infra/ephemeral output -raw worker_security_group_id)"
  aws ecs run-task --region "$REGION" --cluster "$CLUSTER" --launch-type FARGATE \
    --task-definition blogplatform-prod-worker \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$WORKER_SG],assignPublicIp=DISABLED}" \
    --overrides '{"containerOverrides":[{"name":"worker","command":["node","scripts/reconcile.js"]}]}' \
    --query 'tasks[0].taskArn' --output text
  echo "    The result is in the worker log group: /ecs/blogplatform-prod/worker"
else
  echo "==> 4/5 reconciliation dry run skipped (no worker service)"
fi

echo "==> 5/5 ready"
COST=0.15; [ "$HA_VALUE" = true ] && COST=0.24
echo "URL:  $(terraform -chdir=infra/ephemeral output -raw api_url)"
echo "Cost: about \$$COST per hour until you run: make down"
