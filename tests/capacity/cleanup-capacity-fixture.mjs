import { readFile } from 'node:fs/promises';

const [runId, fixturePath] = process.argv.slice(2);
if (!/^CAPTEST_[0-9]{8}_[0-9]{6}_[A-Z0-9]{8}$/.test(runId || '')) throw new Error('run_id inválido');
const supabaseUrl = String(process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;
const start = Math.min(...['[', '{'].map((char) => stdin.indexOf(char)).filter((index) => index >= 0));
const keys = JSON.parse(stdin.slice(start));
const list = Array.isArray(keys) ? keys : keys?.keys || [];
const serviceKey = list.find((entry) => entry.name === 'service_role' || entry.role === 'service_role')?.api_key
  || list.find((entry) => entry.type === 'secret' || String(entry.api_key || '').startsWith('sb_secret_'))?.api_key;
if (!serviceKey || !supabaseUrl) throw new Error('Configuração server-side ausente');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
if (fixture.run_id !== runId) throw new Error('FIXTURE_RUN_ID_MISMATCH');
for (const userId of fixture.auth_user_ids || []) {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!response.ok && response.status !== 404) throw new Error(`AUTH_CLEANUP_HTTP_${response.status}`);
}
process.stdout.write(JSON.stringify({ run_id: runId, auth_users_removed: fixture.auth_user_ids?.length || 0 }));
