# Load tests

[k6](https://k6.io) scenarios for the experiments in [`docs/experiments/`](../docs/experiments/README.md). They run from your laptop against a running session; nothing here is deployed.

| Script | Experiment | What it does |
|---|---|---|
| `writes.js` | E1, E2, E9 | create a post, poll search until it appears, record `write_to_searchable_ms`, then edit and delete it |
| `search.js` | E7 | ramp to 20 virtual users on `/blogs/search` for about 14 minutes |
| `login-burst.js` | E6 | 50 virtual users on `POST /auth/login` with a wrong password; counts 401 / 403 / 429 |

```bash
export BASE_URL=$(terraform -chdir=infra/ephemeral output -raw app_url)
k6 run -e BASE_URL=$BASE_URL -e VUS=5 -e DURATION=5m loadtest/writes.js
k6 run -e BASE_URL=$BASE_URL loadtest/search.js
k6 run -e BASE_URL=$BASE_URL loadtest/login-burst.js
```

`BASE_URL`, `VUS` and `DURATION` come from `-e` flags (the defaults are `http://localhost:5000`, 5 and 5m; `search.js` has fixed stages).

## Before you run them

- **Every virtual user shares your IP**, and the API limits each IP to 10 logins and registrations per 15 minutes and 30 searches/asks per minute. For `writes.js` and `search.js`, apply with `rate_limit_enabled=false` (and leave `enable_waf=false`, whose rule is 300 requests per 5 minutes per IP). `login-burst.js` is the opposite: it needs both on.
- Registration needs usernames of 3-32 characters `[A-Za-z0-9_.-]`; the scenarios create `k6user-<vu>-<timestamp>`. They leave those users behind. Delete them from the `users` collection afterwards if you care.
- `writes.js` deletes the posts it creates, but a run that is stopped mid-iteration leaves some behind (titles start with `Load test k6-`).
- Never point these at an environment with real data and real users.

## Installing k6

`k6` is a single binary: see <https://grafana.com/docs/k6/latest/set-up/install-k6/>. `k6 inspect loadtest/writes.js` checks that a script parses without running it.
