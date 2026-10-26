// E1: how long between a write and the post being searchable?
//   k6 run -e BASE_URL=https://app.example.click -e VUS=5 -e DURATION=5m loadtest/writes.js
// Each iteration creates a post with a unique token in its title, polls search until the token shows up,
// records the delay, then updates and deletes the post.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { login, jsonHeaders } from './lib/session.js';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';
const POLL_INTERVAL_S = 0.5;
const GIVE_UP_AFTER_MS = 30000;

const writeToSearchable = new Trend('write_to_searchable_ms', true);

export const options = {
  vus: Number(__ENV.VUS || 5),
  duration: __ENV.DURATION || '5m',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    write_to_searchable_ms: ['p(95)<10000'],
  },
};

let session;

export default function () {
  session = session || login(BASE_URL);
  const token = `k6-${__VU}-${__ITER}-${Date.now()}`;

  const created = http.post(
    `${BASE_URL}/blogs`,
    JSON.stringify({ title: `Load test ${token}`, content: `Content for ${token}. ${'lorem ipsum '.repeat(40)}` }),
    { headers: jsonHeaders(session.token) },
  );
  if (!check(created, { 'created (201)': (r) => r.status === 201 })) return;
  const id = created.json('blog._id');
  const writtenAt = Date.now();

  let searchable = false;
  while (Date.now() - writtenAt < GIVE_UP_AFTER_MS) {
    const found = http.get(`${BASE_URL}/blogs/search?query=${encodeURIComponent(token)}&searchType=title`);
    if (found.status === 200 && found.body.includes(token)) {
      searchable = true;
      writeToSearchable.add(Date.now() - writtenAt);
      break;
    }
    sleep(POLL_INTERVAL_S);
  }
  check(searchable, { 'became searchable within 30 s': (ok) => ok });

  const updated = http.put(
    `${BASE_URL}/blogs/${id}`,
    JSON.stringify({ title: `Load test ${token} (edited)` }),
    { headers: jsonHeaders(session.token) },
  );
  check(updated, { 'updated (200)': (r) => r.status === 200 });

  const deleted = http.del(`${BASE_URL}/blogs/${id}`, null, { headers: jsonHeaders(session.token) });
  check(deleted, { 'deleted (200)': (r) => r.status === 200 });
}
