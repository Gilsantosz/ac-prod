import {
  chmod, mkdir, readFile, rename, writeFile,
} from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  dirname, isAbsolute, relative, resolve,
} from 'node:path';
import { CAPACITY_PROFILE_REQUIREMENTS } from '../../src/lib/capacityTestControl.js';

const [runId, profile, credentialsPath, outputPathArgument] = process.argv.slice(2);
if (!/^CAPTEST_[0-9]{8}_[0-9]{6}_[A-Z0-9]{8}$/.test(runId || '')) throw new Error('run_id inválido');
const requirement = CAPACITY_PROFILE_REQUIREMENTS[profile];
if (!requirement) throw new Error('profile inválido');
if (!credentialsPath || !outputPathArgument) throw new Error('Informe credentials_path e output_path');

const outputPath = resolve(outputPathArgument);
const repositoryRoot = resolve(process.cwd());
const outputRelativeToRepository = relative(repositoryRoot, outputPath);
if (outputRelativeToRepository === ''
    || (!outputRelativeToRepository.startsWith('..') && !isAbsolute(outputRelativeToRepository))) {
  throw new Error('output_path deve ficar fora do repositório');
}
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });

const supabaseUrl = String(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
).replace(/\/$/, '');
const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
if (!supabaseUrl || !anonKey) throw new Error('SUPABASE_URL/SUPABASE_ANON_KEY ausentes');

let stdin = '';
for await (const chunk of process.stdin) stdin += chunk;
const jsonIndexes = ['[', '{']
  .map((char) => stdin.indexOf(char))
  .filter((index) => index >= 0);
if (jsonIndexes.length === 0) throw new Error('JSON de chaves server-side ausente');
const keys = JSON.parse(stdin.slice(Math.min(...jsonIndexes)));
const list = Array.isArray(keys) ? keys : keys?.keys || [];
const serviceKey = list.find((entry) => entry.name === 'service_role' || entry.role === 'service_role')?.api_key
  || list.find((entry) => entry.type === 'secret' || String(entry.api_key || '').startsWith('sb_secret_'))?.api_key;
if (!serviceKey) throw new Error('Chave server-side não localizada');

const delay = (milliseconds) => new Promise((resolvePromise) => {
  setTimeout(resolvePromise, milliseconds);
});

const request = async (url, options = {}, key = anonKey) => {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let response;
    try {
      response = await fetch(url, {
        ...options,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });
    } catch {
      response = null;
    } finally {
      clearTimeout(timeout);
    }
    if (!response) {
      if (attempt < maxAttempts) {
        await delay(250 * (2 ** (attempt - 1)));
        continue;
      }
      throw new Error('HTTP_NETWORK_RETRY_EXHAUSTED');
    }
    const data = await response.json().catch(() => null);
    if (response.ok) return data;

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < maxAttempts) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds = Number(retryAfterHeader);
      const retryMilliseconds = retryAfterHeader !== null && Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds * 1000
        : 250 * (2 ** (attempt - 1));
      await delay(Math.max(250, Math.min(retryMilliseconds, 30_000)));
      continue;
    }
    throw new Error(`HTTP_${response.status}:${data?.code || data?.error_code || 'REQUEST_FAILED'}`);
  }
  throw new Error('HTTP_RETRY_EXHAUSTED');
};

const expectedFixturePieces = Math.max(100, requirement.pieces);
const fetchFixturePieces = async () => {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; offset <= expectedFixturePieces; offset += pageSize) {
    const filter = encodeURIComponent(`${runId}:piece:%`);
    const page = await request(
      `${supabaseUrl}/rest/v1/production_pieces`
      + `?select=traceability_code,lot_id,sequence_number&piece_uid=like.${filter}`
      + `&order=sequence_number.asc&limit=${pageSize}&offset=${offset}`,
      {},
      serviceKey,
    );
    if (!Array.isArray(page)) throw new Error('CAPACITY_PIECE_PAGE_INVALID');
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  if (rows.length !== expectedFixturePieces) {
    throw new Error(`CAPACITY_PIECE_COUNT_MISMATCH:${rows.length}/${expectedFixturePieces}`);
  }
  return rows;
};

await request(`${supabaseUrl}/rest/v1/rpc/prepare_capacity_atomic_contexts_v3`, {
  method: 'POST',
  body: JSON.stringify({ p_run_id: runId }),
}, serviceKey);
const fixtureContexts = await request(`${supabaseUrl}/rest/v1/rpc/get_capacity_fixture_contexts_v4`, {
  method: 'POST',
  body: JSON.stringify({ p_run_id: runId }),
}, serviceKey);
const pieces = await fetchFixturePieces();
const codes = pieces.map((piece) => String(piece.traceability_code || ''));
if (codes.some((code) => !/^\d{8}$/.test(code)) || new Set(codes).size !== codes.length) {
  throw new Error('CAPACITY_FIXTURE_CODES_INVALID');
}
if (new Set(pieces.map((piece) => piece.lot_id)).size !== 1 || !pieces[0]?.lot_id) {
  throw new Error('CAPACITY_FIXTURE_LOT_INVALID');
}

const contentionMachines = Array.isArray(fixtureContexts?.contention_machines)
  ? fixtureContexts.contention_machines
  : [];
const requiredContentionMachines = profile === 'contention_piece'
  ? 20
  : (profile === 'contention_cell_lot' ? 50 : 0);
if (!fixtureContexts?.cut_cell?.id || !fixtureContexts?.atomic_machine?.id
    || contentionMachines.length !== requiredContentionMachines) {
  throw new Error('CAPACITY_FIXTURE_CONTEXTS_INVALID');
}

const operatorCredentials = JSON.parse(await readFile(credentialsPath, 'utf8')).credentials;
const operatorIndexes = [1, 2, 3, 4, 5, 6, 7, 9];
if (!Array.isArray(operatorCredentials) || operatorCredentials.length < 9) {
  throw new Error('CAPACITY_OPERATOR_CREDENTIALS_INVALID');
}

const fixture = {
  run_id: runId,
  profile,
  created_at: new Date().toISOString(),
  requirements: requirement,
  auth_user_ids: [],
  auth_users_private: [],
  devices: [],
  atomic_devices: [],
  codes,
  contention: {
    lot_id: pieces[0].lot_id,
    cell_name: fixtureContexts.cut_cell.name,
  },
};

const persistFixtureCheckpoint = async () => {
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, outputPath);
  await chmod(outputPath, 0o600);
};
await persistFixtureCheckpoint();

// O objetivo deste ensaio é concorrência por dispositivo operacional, não o
// throughput do endpoint de login Auth. Oito principals isolados sustentam até
// 100 sessões operacionais distintas, cada uma com device_id e session_id únicos.
const authUserCount = 8;
for (let index = 0; index < authUserCount; index += 1) {
  const email = `${runId.toLowerCase()}-${index + 1}@capacity.invalid`;
  const password = `${randomBytes(18).toString('base64url')}A7!`;
  const created = await request(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { test_run_id: runId, is_test: true, created_by: 'capacity_test' },
    }),
  }, serviceKey);
  const authUser = { id: created.id, email, password };
  fixture.auth_user_ids.push(created.id);
  fixture.auth_users_private.push(authUser);
  // Grava o ID imediatamente: mesmo uma falha posterior deixa massa removível.
  await persistFixtureCheckpoint();

  await request(`${supabaseUrl}/rest/v1/profiles?id=eq.${created.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ active: true, role: 'operator', name: `${runId}_AUTH_${index + 1}` }),
  }, serviceKey);
  const session = await request(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  authUser.access_token = session.access_token;
  authUser.refresh_token = session.refresh_token;
  await persistFixtureCheckpoint();
}

for (let deviceIndex = 0; deviceIndex < requirement.devices; deviceIndex += 1) {
  const principalIndex = deviceIndex % authUserCount;
  const operatorIndex = operatorIndexes[principalIndex];
  const credential = operatorCredentials[operatorIndex - 1];
  const authUser = fixture.auth_users_private[principalIndex];
  const deviceId = randomUUID();
  const login = await request(`${supabaseUrl}/rest/v1/rpc/operator_login_v2`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authUser.access_token}` },
    body: JSON.stringify({
      p_login_name: credential.login_name,
      p_registration: credential.registration,
      p_device_id: deviceId,
    }),
  });
  if (!login?.success) throw new Error(`OPERATOR_LOGIN_FAILED_${deviceIndex + 1}`);

  const cells = login.operator?.cells || [];
  const machines = login.operator?.machines || [];
  let cell = cells.find((item) => item.is_primary) || cells[0];
  let machine = machines.find((item) => item.is_primary) || machines[0];
  if (profile === 'atomic8') {
    cell = fixtureContexts.cut_cell;
    machine = fixtureContexts.atomic_machine;
  } else if (requiredContentionMachines > 0) {
    cell = fixtureContexts.cut_cell;
    machine = contentionMachines[deviceIndex];
  }
  if (!cell?.id || !machine?.id) {
    throw new Error(`OPERATOR_CONTEXT_INCOMPLETE_${deviceIndex + 1}`);
  }

  const context = await request(`${supabaseUrl}/rest/v1/rpc/set_operator_session_context`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authUser.access_token}` },
    body: JSON.stringify({
      p_session_token: login.session_token,
      p_cell_id: cell.id,
      p_machine_id: machine.id,
      p_station_name: `${runId}_DEVICE_${deviceIndex + 1}`,
    }),
  });
  if (!context?.success) throw new Error(`OPERATOR_CONTEXT_FAILED_${deviceIndex + 1}`);

  fixture.devices.push({
    device_id: deviceId,
    operator_session_id: login.session_id,
    access_token: authUser.access_token,
    cell_id: cell.id,
    cell_name: cell.name,
    machine_id: machine.id,
    machine_name: machine.name,
    operator_index: operatorIndex,
    auth_principal_slot: principalIndex + 1,
  });
  await persistFixtureCheckpoint();
}

if (profile === 'atomic8') {
  fixture.atomic_devices = fixture.devices.map((device) => ({ ...device }));
}
await persistFixtureCheckpoint();
process.stdout.write(JSON.stringify({
  run_id: runId,
  profile,
  auth_users: fixture.auth_users_private.length,
  devices: fixture.devices.length,
  codes: fixture.codes.length,
  output_path: outputPath,
}));
