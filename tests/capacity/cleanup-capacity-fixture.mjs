import { readFile } from 'node:fs/promises';

const [runId, fixturePath] = process.argv.slice(2);
if (!/^CAPTEST_[0-9]{8}_[0-9]{6}_[A-Z0-9]{8}$/.test(runId || '')) throw new Error('run_id inválido');
const supabaseUrl = String(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
).replace(/\/$/, '');
let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;
const starts = ['[', '{'].map((char) => stdin.indexOf(char)).filter((index) => index >= 0);
if (starts.length === 0) throw new Error('JSON de chaves server-side ausente');
const keys = JSON.parse(stdin.slice(Math.min(...starts)));
const list = Array.isArray(keys) ? keys : keys?.keys || [];
const serviceKey = list.find((entry) => entry.name === 'service_role' || entry.role === 'service_role')?.api_key
  || list.find((entry) => entry.type === 'secret' || String(entry.api_key || '').startsWith('sb_secret_'))?.api_key;
if (!serviceKey || !supabaseUrl) throw new Error('Configuração server-side ausente');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
if (fixture.run_id !== runId) throw new Error('FIXTURE_RUN_ID_MISMATCH');
const authHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
const userIds = new Set(fixture.auth_user_ids || []);

// Também encontra uma criação cujo POST foi efetivado, mas cuja resposta se
// perdeu antes do checkpoint. O filtro triplo evita tocar usuários não CAPTEST.
let page = 1;
let discoveryComplete = false;
while (page <= 100) {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`, {
    headers: authHeaders,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`AUTH_DISCOVERY_HTTP_${response.status}`);
  const users = Array.isArray(data?.users) ? data.users : [];
  for (const user of users) {
    const metadata = user.user_metadata || user.raw_user_meta_data || {};
    if (metadata.test_run_id === runId
        && metadata.is_test === true
        && metadata.created_by === 'capacity_test') {
      userIds.add(user.id);
    }
  }
  const nextPage = Number(data?.next_page ?? data?.nextPage);
  if (Number.isInteger(nextPage) && nextPage > page) {
    page = nextPage;
  } else if (users.length === 1000) {
    page += 1;
  } else {
    discoveryComplete = true;
    break;
  }
}
if (!discoveryComplete) throw new Error('AUTH_DISCOVERY_PAGE_LIMIT_EXCEEDED');

for (const userId of userIds) {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE', headers: authHeaders,
  });
  if (!response.ok && response.status !== 404) throw new Error(`AUTH_CLEANUP_HTTP_${response.status}`);
}
process.stdout.write(JSON.stringify({ run_id: runId, auth_users_removed: userIds.size }));
