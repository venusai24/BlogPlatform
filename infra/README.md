# Infrastructure

Three Terraform stacks, applied in this order:

| Stack | What it holds | State key |
|---|---|---|
| `bootstrap/` | The S3 bucket that stores Terraform state | `bootstrap/terraform.tfstate` (after the one-off migration below) |
| `persistent/` | Things that outlive a session: ECR repositories, SSM secret placeholders, the GitHub OIDC role, the ops-alerts topic, DNS and the TLS certificate, the budget | `persistent/terraform.tfstate` |
| `ephemeral/` | The running system: VPC, ALB, ECS services, Redis/Qdrant, queues, alarms. Created for a session and destroyed after | `ephemeral/terraform.tfstate` |

`persistent` is read by `ephemeral` through `terraform_remote_state`, so apply it first and after any change to its outputs.

```bash
# bootstrap, first time only: the bucket does not exist yet, so run it with local state.
# Comment out the `backend "s3"` block in infra/bootstrap/main.tf, then:
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap apply -var bucket_name=<state bucket>
# restore the backend block and move the state into the new bucket (see Human steps):
terraform -chdir=infra/bootstrap init -migrate-state -backend-config="bucket=<state bucket>"

terraform -chdir=infra/persistent init  -backend-config="bucket=<state bucket>"
terraform -chdir=infra/persistent apply
terraform -chdir=infra/ephemeral  init  -backend-config="bucket=<state bucket>"
terraform -chdir=infra/ephemeral  apply -var state_bucket=<state bucket> -var api_image_tag=<existing git SHA>
```

## Sessions

The ephemeral layer costs about $0.15 an hour ($0.24 with `HA=1`) while it exists, so it is created for a session and destroyed after. From the repository root:

```bash
IMAGE_TAG=<git sha> WEB_IMAGE_TAG=<git sha> make up     # persistent apply, ephemeral apply, wait, reconcile dry run
make status                                             # read-only: what is running and how old is it
make down                                               # destroy the ephemeral layer, then check nothing is left
```

`make up` takes `EDGE` (`alb_https` default, `alb_http`, `cloudfront`), `HA=1`, `WORKER=0`, `STATE_BUCKET`, `EXTRA_TF_ARGS` (for example `"-var enable_waf=true"`) and `AUTO_APPROVE=1`; see `scripts/session/up.sh`. Every ephemeral resource is tagged `Project`, `Env`, `Layer=ephemeral` and `Session=<start time>`, which is how `status` finds them. It also counts NAT gateways and `blogplatform-*` load balancers directly, because those bill by the hour even if a tag is lost, and exits 1 if anything is older than `MAX_HOURS` (default 12) or has no `Session` tag.

A daily GitHub workflow (`session-watchdog.yml`, 06:00 UTC) runs `status` with a read-only role and fails, so GitHub emails you, if a session was forgotten. It never destroys anything. One-off: apply `persistent`, then set the repository secret `AWS_READONLY_ROLE_ARN` to its `session_watchdog_role_arn` output.

## Checks (no AWS access needed)

```bash
terraform fmt -check -recursive infra
for s in bootstrap persistent ephemeral; do terraform -chdir=infra/$s init -backend=false -input=false && terraform -chdir=infra/$s validate; done
terraform -chdir=infra/persistent test
terraform -chdir=infra/ephemeral  test
(cd infra && tflint --init --config "$PWD/.tflint.hcl" && tflint --recursive --config "$PWD/.tflint.hcl")
```

`terraform test` runs against mocked providers; it never touches AWS. CI (`.github/workflows/deploy-api.yml`) runs the same commands on every pull request and push.

## How changes reach AWS

- **Application code** goes live through CI: a push to `main` builds `blog-api`, pushes the image tagged with the commit SHA, registers a new task definition revision from the current one, and deploys it to the API service (and to the worker service when it exists). The frontend workflow does the same for the `web` service.
- **Terraform changes to the container environment** (flags, URLs, secrets) are registered as a new task definition revision by `apply`, but the services ignore `task_definition` drift, so **they go live on the next CI deploy**, not at `apply`. To roll one out sooner, run `aws ecs update-service --cluster blogplatform-prod-cluster --service <service> --task-definition <family> --force-new-deployment`.
- **Image tags are immutable.** `latest` cannot be overwritten. Pass `api_image_tag` (and `web_image_tag`) to `apply` as a SHA that already exists in ECR.
- Redis and Qdrant stop the old task before starting the new one, because both keep their data on an EFS volume that must only have one writer.

## Tracing

`enable_tracing = true` adds an AWS Distributed Tracing (ADOT) collector sidecar to the api and worker tasks and turns the OpenTelemetry SDK on (`OTEL_SDK_DISABLED=false`). Spans leave the app over OTLP to `localhost:4318`, the collector forwards them to X-Ray, and the task role gains the four X-Ray write/sampling actions. Because the outbox record stores the request's W3C `traceparent`, one trace follows a write through the outbox relay and the SNS/SQS hop to the indexing consumer (the consumer span records `blog.outbox_to_consume_ms`). With tracing off the image does not start the SDK at all. The collector image is pinned (`public.ecr.aws/aws-observability/aws-otel-collector:v0.50.0`, the newest release on 2026-10-17); bump it in `infra/ephemeral/tracing.tf` on purpose, not by tracking `latest`. Rollback: `enable_tracing = false`.

## Fault injection

For the resilience experiments (`docs/audit/TARGET_ARCHITECTURE.md`, section on experiments): `fault_embed_error_rate` and `fault_llm_error_rate` (0-1 strings) make that share of embedding or LLM calls fail (the embedding fault is named `ThrottlingException`, like Bedrock throttling), and `fault_relay_pause = true` stops the outbox relay claiming records so the backlog builds up. Everything is off by default. The app ignores these settings when `NODE_ENV=production` unless `fault_injection_enabled = true` (and logs an error at startup if any were set without it), so they cannot be left on by accident. They reach the api, the worker and the Lambda consumer. Remember that the containers only pick up a changed environment on the next deploy (see above).

## WAF

`enable_waf = true` puts an AWS WAF web ACL in front of the app: a rate rule (300 requests per 5 minutes per IP on `/auth/`, `/blogs/search`, `/blogs/ask`, `/blogs/summarize`, `/blogs/semanticSearchbyTitle`), `AWSManagedRulesCommonRuleSet` and `AWSManagedRulesKnownBadInputsRuleSet`. `SizeRestrictions_BODY` is set to *count* instead of *block*: the managed rule blocks bodies over 8 KB, but posts may be up to 50,000 characters. The ACL is regional and associated with the ALB; for `edge_mode = "cloudfront"` it is a CloudFront-scoped ACL created in us-east-1, which the (not yet built) CloudFront distribution will attach. **Check the WAF sampled requests during the first session**: a managed rule can block legitimate traffic. The app's own Redis rate limiter still applies below the WAF threshold. Rollback: `enable_waf = false`.

## Secrets in Terraform state

Secrets are injected from SSM parameters by ARN, so the MongoDB URI, JWT secret and API keys are not in state. One exception: with `redis_mode = "elasticache"`, ElastiCache requires the AUTH token as an argument of the replication group, so the generated token (`random_password.redis`) **is** in the ephemeral state. Keep the state bucket private and encrypted (the bootstrap stack does both), and treat the ephemeral state as sensitive. The token only protects a cache that is rebuilt every session.

Switching `redis_mode` discards Redis contents: in-flight summarize jobs and rate-limit counters are lost, which is acceptable.

## Feature flags

Security and correctness fixes default to the new behaviour with a flag to restore the old one. Architectural changes default to the legacy behaviour and are switched on by Terraform.

| Flag (env) | Values | Default in code | Owner task |
|---|---|---|---|
| `AUTH_REQUIRED_WRITES` | `true`/`false` | `true` | T05 |
| `RATE_LIMIT_ENABLED` (TF `rate_limit_enabled`) | `true`/`false` | `true` | T09 |
| `CORS_ALLOWED_ORIGINS` | comma list or `*` | `*` | T09 |
| `LLM_PROVIDER` | `groq`/`bedrock` | `groq` | T06 |
| `RUN_WORKERS` | `true`/`false` | `true` | T11 |
| `INDEXING_BACKEND` | `bullmq`/`both`/`events` | `bullmq` | T13 |
| `OUTBOX_RELAY_ENABLED` | `true`/`false` | `false` | T14 |
| `INDEXING_CONSUMER_MODE` | `off`/`shadow`/`active` | `off` | T17 |
| `RECONCILE_INTERVAL_MS` | integer, `0` = off | `0` | T18 |
| `VECTOR_STORE` (TF `vector_store`) | `qdrant`/`s3vectors` | `qdrant` | T16/T25 |
| TF `enable_worker_service` | bool | `false` | T12 |
| TF `enable_domain_events` | bool | `false` | T15 |
| TF `edge_mode` | `alb_http`/`alb_https`/`cloudfront` | `alb_http` | T21 / T21C |
| TF `domain_name` | e.g. `example.click` | none (required for `alb_https`) | T21 |
| `AUTH_PROVIDER` | `app`/`cognito` | `app` | T31 |
| TF `redis_mode` | `fargate`/`elasticache` | `fargate` | T24 |
| `VECTOR_STORE_WRITE` (TF `vector_store_write`) | `primary`/`both` | `primary` | T25 |
| `OTEL_SDK_DISABLED` | `true`/`false` | `true` | T20B |
| `FAULT_INJECTION_ENABLED`, `FAULT_EMBED_ERROR_RATE`, `FAULT_LLM_ERROR_RATE`, `FAULT_RELAY_PAUSE` | bool / 0-1 / bool | off / `0` | T28 |
| TF `ha_mode` | bool | `false` | T26 |
| TF `enable_waf` | bool | `false` | T21B |
| TF `enable_tracing` | bool | `false` | T20B |
| TF `indexing_consumer_runtime` | `ecs`/`lambda` | `ecs` | T17L |

Flags whose task has not landed yet are listed so the names are reserved; they do nothing until it does.

## Human steps

Things only the repository owner does (the implementation never runs `apply`, `destroy` or a mutating AWS command). Steps for tasks that have not landed yet are copied from `docs/audit/IMPLEMENTATION_PLAN.md` so there is one list.

**One-off, before the first deploy**
- **State bucket.** `terraform -chdir=infra/bootstrap init -migrate-state -backend-config="bucket=blogplatform-state-venusai-2026"` moves the bootstrap state into the bucket it created (T23).
- **CI.** Push the branch (CI exists only once it is pushed) and set the repository secret `AWS_DEPLOY_ROLE_ARN` (T23).
- **CI refused by AWS** (`Not authorized to perform sts:AssumeRoleWithWebIdentity` in the "Configure AWS credentials" step): the repository's OIDC tokens name it with immutable ids. Find the `sub` in CloudTrail (event `AssumeRoleWithWebIdentity`, region `ap-south-1`), set `github_repo_id_subject = "<owner>@<id>/<repo>@<id>"` in `infra/persistent/terraform.tfvars`, and apply `persistent`.

**Region move to ap-south-1 (T02B)**
1. Copy the four SSM secrets out of `eu-north-1` before deleting anything.
2. Delete the `eu-north-1` ECR repository, SSM parameters and the Container Insights log group.
3. Set `region = "ap-south-1"` in both `terraform.tfvars` files.
4. `terraform -chdir=infra/persistent plan` must show only the ECR repository, its lifecycle policy and the SSM parameters being created. Anything else: stop.
5. Apply, then put the four secret values back in `ap-south-1` and delete the temporary files.
6. In Atlas, allow the new NAT public IP(s) after the first ephemeral apply.

**Secrets and keys**
- **JWT secret (T04).** After the first deploy, rotate: `aws ssm put-parameter --name /blogplatform/prod/jwt_secret --type SecureString --overwrite --value "$(openssl rand -base64 48)"` and redeploy. Every session logs out.
- **Groq API key.** `aws ssm put-parameter --region ap-south-1 --name /blogplatform/prod/groq_api_key --type SecureString --overwrite --value "<key>"` after applying `persistent`.
- **Qdrant API key (T22).** `aws ssm put-parameter --region ap-south-1 --name /blogplatform/prod/qdrant_api_key --type SecureString --overwrite --value "$(openssl rand -hex 32)"` before applying, because the current value is the placeholder. Then force a new Qdrant deployment.
- **LLM prices (T06).** Fill `LLM_PRICE_IN_PER_MTOK` / `LLM_PRICE_OUT_PER_MTOK` from the Groq pricing page.
- **Bedrock (T06, shelved).** Before switching `LLM_PROVIDER` back to `bedrock`, the `converse` smoke test for `openai.gpt-oss-20b-1:0` in `ap-south-1` must return text (see `docs/audit/SHELVED_BEDROCK_LLM.md`).

**Alerts and DNS**
- **Ops alerts (T19).** Add `alert_email` to `infra/persistent/terraform.tfvars`, apply `persistent`, confirm the subscription email, then apply `ephemeral`.
- **HTTPS (T21).** Register the domain (Route 53), set `domain_name` in both tfvars, apply `persistent` (the certificate validates in a few minutes), set the GitHub variable `APP_URL=https://app.<domain>`, and for the first session set `edge_mode=alb_https` with `web_image_tag` set to a pushed SHA.

**Data and cutovers**
- **Monitoring logs (T10).** The first boot creates a 30-day TTL index on `MonitoringLog`; `mongoexport` the collection first to keep older history.
- **Worker service (T12).** `terraform apply -var enable_worker_service=true`; CI then deploys both services.
- **Transactions (T13).** Before enabling `INDEXING_BACKEND=both`, confirm `startSession().withTransaction` works on the real Atlas cluster with a scratch collection.
- **Reconciliation (T18).** Run `node scripts/reconcile.js` from `blog-api/` (dry run) and review the counts before `--apply`; the first apply re-embeds every legacy post.
- **Event cutover (T19).** One apply per step, each after its exit criterion in `docs/audit/TARGET_ARCHITECTURE.md` section 5:
  1. `enable_domain_events=true`, `indexing_backend="both"`, `indexing_consumer_mode="shadow"`
  2. `indexing_consumer_mode="active"`
  3. `indexing_backend="events"`, `reconcile_interval_ms="21600000"`, `reconcile_dry_run="false"`

**Lambda indexing consumer (T17L)** — `indexing_consumer_runtime = "lambda"` (needs `enable_domain_events`) replaces the worker's poller with an SQS-triggered function.
1. CI only builds the Lambda image once the function exists, so the first image is built by hand (from the repository root, logged in to ECR):
   `docker build --provenance=false --target lambda -t <ecr>/blogplatform-api:<sha>-lambda blog-api && docker push <ecr>/blogplatform-api:<sha>-lambda`.
2. Apply with `-var indexing_consumer_runtime=lambda -var lambda_image_tag=<sha>-lambda`. From then on CI pushes `<sha>-lambda` and runs `aws lambda update-function-code` on every deploy; Terraform ignores later image changes.
3. The queue's visibility timeout becomes 360 s and the worker stops polling. Only one runtime consumes at a time.
Rollback: `indexing_consumer_runtime = "ecs"`.

**S3 Vectors (T25)** — the persistent stack now uses the AWS provider 6.x (5.x has no `aws_s3vectors_*` resources) and creates the vector bucket and three 512-dimension indexes.
1. Run `terraform -chdir=infra/persistent init -upgrade`, then `terraform -chdir=infra/persistent plan`. The provider upgrade must cause **no changes to existing resources** (only the new bucket, three indexes and output); if it shows anything else, stop and report. Then apply.
2. Migration, one step at a time:
   1. Deploy with `vector_store_write = "both"` (Qdrant stays the read store).
   2. Backfill: `node scripts/reindex.js --store s3vectors` (a one-off ECS task or a shell with the app environment).
   3. Run `blog-api/evaluation/mini_eval.js` against both stores; continue only if MRR is within 0.05.
   4. Set `vector_store = "s3vectors"`.
   5. After two clean sessions on S3 Vectors, set `vector_store_write = "primary"` and remove Qdrant from the ephemeral stack.
3. **Smoke check before step 2:** confirm that `DeleteVectors` with keys that do not exist succeeds. The store deletes a post's vectors by its deterministic key range (256 content keys, one title, one summary); if the call errors on missing keys, stop and report.
Rollback: `vector_store = "qdrant"` (Qdrant stays populated while `both` is on).

**NAT addresses and HA mode (T26)** — the NAT gateways' Elastic IPs now belong to the `persistent` stack, so they are the same every session.
1. Apply `persistent` (creates two Elastic IPs; each costs about $3.65 a month while idle). The ephemeral stack cannot be planned until this is done, because it reads their ids.
2. Add **both** `nat_eip_public_ips` (output of `persistent`) to the MongoDB Atlas IP access list, once. Without this the API cannot reach Atlas.
3. Run a session with `ha_mode=true` for the failover and scaling experiments.
Rollback: `ha_mode = false`. Terraform variable `api_desired_count` is gone (the count follows `ha_mode`); remove it from any tfvars. The ephemeral output `nat_public_ip` is now the list `nat_public_ips`.

**Cognito sign-in (T31)** — `auth_provider = "cognito"` replaces the API's own login with Amazon Cognito managed login (authorization code flow with PKCE). The user pool lives in `persistent`, so users survive a teardown. The API stops issuing tokens (`/auth/login` and `/auth/register` answer 410) and only verifies Cognito access tokens. Both code paths remain; the default is `app`.
1. Apply `persistent` (creates the pool, its hosted domain and the web app client; `domain_name` must be set for the app's own callback URLs, localhost always works). Pool deletion protection is on.
2. Copy the existing users in: `COGNITO_USER_POOL_ID=<pool> MONGODB_URI=<uri> node blog-api/scripts/migrateUsersToCognito.js` is a dry run; add `--apply` to create them. Password hashes cannot move, so each user gets a random temporary password and must choose a new one at first sign-in. The CSV (`username,temporaryPassword`) goes to **stdout only**: capture it somewhere private, hand the passwords over once, then delete it.
3. Turn it on for a session: apply `ephemeral` with `-var auth_provider=cognito`, and set the GitHub repository variables `AUTH_PROVIDER=cognito`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` and `COGNITO_DOMAIN` (from the `persistent` outputs `cognito_user_pool_id`, `cognito_client_id`, `cognito_domain`) before the frontend image is built; they are baked into the bundle.
4. Existing posts keep working: authors are matched by username, and the migration keeps the usernames.
Rollback: `auth_provider = "app"` and rebuild the frontend with `AUTH_PROVIDER` empty. Risk: high (authentication across API and frontend); the first sign-in after migration needs the temporary password.

**Not yet implemented** (from the plan; do not act on these until the task lands)
- *T21C, CloudFront:* confirm the account can create distributions, apply in a quiet window, verify `https://<domain>/health` and a deep link; set `REACT_APP_API_URL` and `CLOUDFRONT_DISTRIBUTION_ID` secrets.
