import { randomInt } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAPACITY_PROFILE_REQUIREMENTS } from '../../src/lib/capacityTestControl.js';

const runId = process.argv[2];
const profile = String(process.argv[3] || '');
if (!/^CAPTEST_[0-9]{8}_[0-9]{6}_[A-Z0-9]{8}$/.test(runId || '')) throw new Error('run_id inválido');
const requirement = CAPACITY_PROFILE_REQUIREMENTS[profile];
if (!requirement) throw new Error('profile inválido');

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = path.resolve(process.env.CAPTEST_PRIVATE_DIR || '/private/tmp/acprod-capacity-private');
const rootRelativeToRepository = path.relative(repositoryRoot, root);
if (rootRelativeToRepository === ''
    || (!rootRelativeToRepository.startsWith('..') && !path.isAbsolute(rootRelativeToRepository))) {
  throw new Error('CAPTEST_PRIVATE_DIR deve ficar fora do repositório');
}
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
  `select public.seed_capacity_fixture_v4('${runId}', '${profile}', '${registrationSeed}');`,
  'commit;',
].join('\n'), { mode: 0o600 });
await chmod(sqlPath, 0o600);
process.stdout.write(JSON.stringify({
  run_id: runId,
  profile,
  required_devices: requirement.devices,
  required_pieces: requirement.pieces,
  sql_path: sqlPath,
  credentials_path: credentialsPath,
}));
