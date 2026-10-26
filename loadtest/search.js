// E7: does the API scale out under search load?
//   k6 run -e BASE_URL=https://app.example.click loadtest/search.js
// Ramps to 20 virtual users against /blogs/search for about 14 minutes. Needs rate_limit_enabled=false
// (every user comes from one IP and the limiter allows 30 searches a minute).
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';
const QUERIES = ['node', 'react', 'aws', 'search', 'database', 'queue', 'cache', 'deploy'];

export const options = {
  stages: [
    { duration: '2m', target: 5 },
    { duration: '5m', target: 20 },
    { duration: '5m', target: 20 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
  },
};

export default function () {
  const query = QUERIES[(__VU + __ITER) % QUERIES.length];
  const response = http.get(`${BASE_URL}/blogs/search?query=${query}&searchType=content`);
  check(response, {
    'search succeeded (200)': (r) => r.status === 200,
    'has a search mode header': (r) => ['semantic', 'fallback'].includes(r.headers['X-Search-Mode']),
  });
  sleep(1);
}
