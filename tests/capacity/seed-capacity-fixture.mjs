import { randomInt } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const runId = process.argv[2];
const pieces = Number(process.argv[3] || 500);
if (!/^CAPTEST_[0-9]{8}_[0-9]{6}_[A-Z0-9]{8}$/.test(runId || '')) throw new Error('run_id inválido');
if (!Number.isInteger(pieces) || pieces < 100 || pieces > 1000) throw new Error('pieces deve estar entre 100 e 1000');

const root = process.env.CAPTEST_PRIVATE_DIR || '/private/tmp/acprod-capacity-private';
await mkdir(root, { recursive: true, mode: 0o700 });
const registrationSeed = String(randomInt(10_000_000, 99_999_999));
const credentials = Array.from({ length: 14 }, (_, index) => ({
  operator_index: index + 1,
  login_name: `${runId}_op_${String(index + 1).padStart(2, '0')}`.toLowerCase(),
  registration: `${registrationSeed}${String(index + 1).padStart(2, '0')}`,
}));
const credentialsPath = path.join(root, `${runId}-operator-credentials.json`);
const sqlPath = path.join(root, `${runId}-seed.sql`);
await writeFile(credentialsPath, JSON.stringify({ run_id: runId, credentials }, null, 2), { mode: 0o600 });
await chmod(credentialsPath, 0o600);
await writeFile(sqlPath, [
  'begin;',
  "select set_config('request.jwt.claim.role', 'service_role', true);",
  `select public.seed_capacity_fixture_v3('${runId}', ${pieces}, '${registrationSeed}');`,
  'commit;',
].join('\n'), { mode: 0o600 });
await chmod(sqlPath, 0o600);
process.stdout.write(JSON.stringify({ run_id: runId, sql_path: sqlPath, credentials_path: credentialsPath }));

