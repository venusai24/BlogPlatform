// Shared by the scenarios: create a throwaway user and return a bearer token.
import http from 'k6/http';
import { check, fail } from 'k6';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function jsonHeaders(token) {
  return token ? { ...JSON_HEADERS, Authorization: `Bearer ${token}` } : JSON_HEADERS;
}

// Registers `k6user-<vu>-<time>` and logs in. Call it once per VU, from setup-like code at the top of
// the first iteration. Fails the iteration (not the whole run) if the API refuses.
export function login(baseUrl) {
  const username = `k6user-${__VU}-${Date.now()}`;
  const password = 'k6-load-test-password';
  const credentials = JSON.stringify({ username, password });

  const registered = http.post(`${baseUrl}/auth/register`, credentials, { headers: JSON_HEADERS });
  check(registered, { 'registered (201)': (r) => r.status === 201 });

  const response = http.post(`${baseUrl}/auth/login`, credentials, { headers: JSON_HEADERS });
  const ok = check(response, { 'logged in (200)': (r) => r.status === 200 });
  if (!ok) {
    // 429 here means the app's per-IP login limiter is on: set rate_limit_enabled=false for load tests.
    fail(`login failed with ${response.status}`);
  }
  return { username, token: response.json('token') };
}
