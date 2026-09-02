import { readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';

const [runId, credentialsPath, outputPath] = process.argv.slice(2);
if (!/^CAPTEST_[0-9]{8}_[0-9]{6}_[A-Z0-9]{8}$/.test(runId || '')) throw new Error('run_id inválido');
if (!credentialsPath || !outputPath) throw new Error('Informe credentials_path e output_path');
const supabaseUrl = String(process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
if (!supabaseUrl || !anonKey) throw new Error('VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY ausentes');

let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;
const jsonStart = Math.min(...['[', '{'].map((char) => {
  const index = stdin.indexOf(char);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}));
const keys = JSON.parse(stdin.slice(jsonStart));
const list = Array.isArray(keys) ? keys : keys?.keys || [];
const serviceKey = list.find((entry) => entry.name === 'service_role' || entry.role === 'service_role')?.api_key
  || list.find((entry) => entry.type === 'secret' || String(entry.api_key || '').startsWith('sb_secret_'))?.api_key;
if (!serviceKey) throw new Error('Chave server-side não localizada');

const request = async (url, options = {}, key = anonKey) => {
  const response = await fetch(url, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`HTTP_${response.status}:${data?.code || data?.error_code || 'REQUEST_FAILED'}`);
  return data;
};

const authUsers = [];
for (let index = 0; index < 8; index += 1) {
  const email = `${runId.toLowerCase()}-${index + 1}@capacity.invalid`;
  const password = `${randomBytes(18).toString('base64url')}A7!`;
  const created = await request(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { test_run_id: runId, is_test: true, created_by: 'capacity_test' } }),
  }, serviceKey);
  await request(`${supabaseUrl}/rest/v1/profiles?id=eq.${created.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ active: true, role: 'operator', name: `${runId}_AUTH_${index + 1}` }),
  }, serviceKey);
  const session = await request(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', body: JSON.stringify({ email, password }),
  });
  authUsers.push({ id: created.id, email, password, access_token: session.access_token, refresh_token: session.refresh_token });
}

const operatorCredentials = JSON.parse(await readFile(credentialsPath, 'utf8')).credentials;
const operatorIndexes = [1, 2, 3, 4, 5, 6, 7, 9];
const devices = [];
for (let deviceIndex = 0; deviceIndex < operatorIndexes.length; deviceIndex += 1) {
  const credential = operatorCredentials[operatorIndexes[deviceIndex] - 1];
  const authUser = authUsers[deviceIndex];
  const deviceId = randomUUID();
  const login = await request(`${supabaseUrl}/rest/v1/rpc/operator_login_v2`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authUser.access_token}` },
    body: JSON.stringify({ p_login_name: credential.login_name, p_registration: credential.registration, p_device_id: deviceId }),
  });
  if (!login?.success) throw new Error(`OPERATOR_LOGIN_FAILED_${deviceIndex + 1}`);
  const cells = login.operator?.cells || [];
  const machines = login.operator?.machines || [];
  const cell = cells.find((item) => item.is_primary) || cells[0];
  const primaryMachine = machines.find((item) => item.is_primary) || machines[0];
  const machine = deviceIndex === 7
    ? (machines.find((item) => item.id !== primaryMachine.id && item.name !== primaryMachine.name) || primaryMachine)
    : primaryMachine;
  const context = await request(`${supabaseUrl}/rest/v1/rpc/set_operator_session_context`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authUser.access_token}` },
    body: JSON.stringify({ p_session_token: login.session_token, p_cell_id: cell.id, p_machine_id: machine.id, p_station_name: `${runId}_DEVICE_${deviceIndex + 1}` }),
  });
  if (!context?.success) throw new Error(`OPERATOR_CONTEXT_FAILED_${deviceIndex + 1}`);
  devices.push({
    device_id: deviceId,
    operator_session_id: login.session_id,
    access_token: authUser.access_token,
    cell_id: cell.id,
    cell_name: cell.name,
    machine_id: machine.id,
    machine_name: machine.name,
    operator_index: operatorIndexes[deviceIndex],
    atomic_cell_id: cells.find((item) => String(item.name).trim().toLowerCase() === 'corte')?.id,
    atomic_cell_name: cells.find((item) => String(item.name).trim().toLowerCase() === 'corte')?.name,
    atomic_machine_id: machines.find((item) => String(item.name).trim().toLowerCase() === 'nanshing')?.id,
    atomic_machine_name: machines.find((item) => String(item.name).trim().toLowerCase() === 'nanshing')?.name,
  });
}

const pieces = await request(`${supabaseUrl}/rest/v1/production_pieces?select=traceability_code,lot_id&piece_uid=like.${encodeURIComponent(`${runId}:piece:%`)}&order=sequence_number.asc&limit=1000`, {}, serviceKey);
const fixture = {
  run_id: runId,
  created_at: new Date().toISOString(),
  auth_user_ids: authUsers.map((user) => user.id),
  auth_users_private: authUsers,
  devices,
  atomic_devices: devices.map((device) => ({
    ...device,
    cell_id: device.atomic_cell_id,
    cell_name: device.atomic_cell_name,
    machine_id: device.atomic_machine_id,
    machine_name: device.atomic_machine_name,
  })),
  codes: pieces.map((piece) => piece.traceability_code),
  contention: { lot_id: pieces[0]?.lot_id || null, cell_name: 'Corte' },
};
await writeFile(outputPath, JSON.stringify(fixture, null, 2), { mode: 0o600 });
await chmod(outputPath, 0o600);
process.stdout.write(JSON.stringify({ run_id: runId, auth_users: authUsers.length, devices: devices.length, codes: fixture.codes.length, output_path: outputPath }));
