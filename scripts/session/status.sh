#!/usr/bin/env bash
# Read-only: what is running in the ephemeral layer, and is it overdue for teardown?
#
#   scripts/session/status.sh                 exit 0: nothing running, or a session younger than MAX_HOURS
#   MAX_HOURS=6 scripts/session/status.sh     exit 1: something is running and it is too old, or has no
#                                             Session tag (so its age is unknown)
#
# It also counts NAT gateways and blogplatform-* load balancers directly, because those bill hourly
# even if a resource lost its tags. It only calls get-/describe- operations and never changes anything.
set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"
MAX_HOURS="${MAX_HOURS:-12}"
NOW="${NOW_EPOCH:-$(date +%s)}"

FILTERS=(--tag-filters Key=Project,Values=blogplatform Key=Layer,Values=ephemeral)

tagged=$(aws resourcegroupstaggingapi get-resources --region "$REGION" "${FILTERS[@]}" \
  --query 'length(ResourceTagMappingList)' --output text)
session=$(aws resourcegroupstaggingapi get-resources --region "$REGION" "${FILTERS[@]}" \
  --query "ResourceTagMappingList[].Tags[?Key=='Session'].Value | [] | sort(@) | [0]" --output text)
nat=$(aws ec2 describe-nat-gateways --region "$REGION" --filter Name=state,Values=available \
  --query 'length(NatGateways)' --output text)
albs=$(aws elbv2 describe-load-balancers --region "$REGION" \
  --query "length(LoadBalancers[?starts_with(LoadBalancerName, 'blogplatform-')])" --output text)

echo "$tagged ephemeral resources tagged Project=blogplatform, Layer=ephemeral (region $REGION)"
echo "$nat NAT gateway(s) available, $albs load balancer(s) named blogplatform-*"

if [ "$tagged" = "0" ] && [ "$nat" = "0" ] && [ "$albs" = "0" ]; then
  echo "Nothing is running."
  exit 0
fi

# Which session is it, and how old? "unset" (the default) or a missing tag means we cannot tell.
started_epoch=""
if [ -n "$session" ] && [ "$session" != "None" ] && [ "$session" != "unset" ]; then
  started_epoch=$(date -u -d "$session" +%s 2>/dev/null || true)
fi

if [ -z "$started_epoch" ]; then
  echo "No usable Session tag on the running resources, so their age is unknown." >&2
  echo "Check what is running and run: make down" >&2
  exit 1
fi

age_hours=$(awk -v now="$NOW" -v start="$started_epoch" 'BEGIN { printf "%.1f", (now - start) / 3600 }')
echo "Session started $session ($age_hours hours ago)"

if awk -v age="$age_hours" -v max="$MAX_HOURS" 'BEGIN { exit !(age > max) }'; then
  echo "This session is older than $MAX_HOURS hours and is still billing. Run: make down" >&2
  exit 1
fi
exit 0
