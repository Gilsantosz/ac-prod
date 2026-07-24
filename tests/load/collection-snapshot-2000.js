import http from 'k6/http';
import { check, fail } from 'k6';

const baseUrl = __ENV.SUPABASE_URL;
const token = __ENV.SUPABASE_ANON_KEY;
const cell = __ENV.CELL_NAME || 'Corte';

if (!baseUrl || !token) fail('Defina SUPABASE_URL e SUPABASE_ANON_KEY.');
if (baseUrl.includes('uozuzdfvnufsjsonswag') && __ENV.K6_ALLOW_PRODUCTION !== '1') {
  fail('Teste em produção bloqueado. Use um branch Supabase ou confirme K6_ALLOW_PRODUCTION=1.');
}

export const options = {
  scenarios: {
    simultaneous_operators: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 250 },
        { duration: '3m', target: 1000 },
        { duration: '5m', target: 2000 },
        { duration: '5m', target: 2000 },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
  },
};

export default function () {
  const response = http.post(
    `${baseUrl}/rest/v1/rpc/get_collection_cell_snapshot`,
    JSON.stringify({
      p_cell_name: cell,
      p_workstation_id: null,
      p_shift: null,
      p_date_from: null,
      p_date_to: null,
    }),
    {
      headers: {
        apikey: token,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      tags: { operation: 'collection_snapshot' },
    },
  );

  check(response, {
    'snapshot 200': (result) => result.status === 200,
    'snapshot JSON': (result) => {
      try {
        return Boolean(result.json());
      } catch {
        return false;
      }
    },
  });
}

