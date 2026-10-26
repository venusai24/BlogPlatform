// E6: who stops a login flood, the WAF or the app?
//   k6 run -e BASE_URL=https://app.example.click loadtest/login-burst.js
// 50 virtual users hammer POST /auth/login with a wrong password for 30 seconds and the run counts the
// answers by status code:
//   401  reached the app and was rejected
//   429  the app's own limiter (10 attempts per 15 minutes per IP)
//   403  the WAF rate rule (300 requests per 5 minutes per IP on /auth/)
// Needs enable_waf=true and rate_limit_enabled=true.
import http from 'k6/http';
import { Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';

const reachedApp = new Counter('login_401_reached_app');
const appLimiter = new Counter('login_429_app_limiter');
const wafBlock = new Counter('login_403_waf_block');
const other = new Counter('login_other');

export const options = {
  vus: Number(__ENV.VUS || 50),
  duration: __ENV.DURATION || '30s',
};

export default function () {
  const response = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ username: 'does-not-exist', password: 'wrong-password' }),
    {
      headers: { 'Content-Type': 'application/json' },
      // These statuses are expected here, so they must not count as failed requests.
      responseCallback: http.expectedStatuses(401, 403, 404, 429),
    },
  );
  if (response.status === 401 || response.status === 404) reachedApp.add(1);
  else if (response.status === 429) appLimiter.add(1);
  else if (response.status === 403) wafBlock.add(1);
  else other.add(1);
}
