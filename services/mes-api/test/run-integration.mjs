import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';

const folder = mkdtempSync(join(tmpdir(), 'mes-api-pg-'));
let started = false;
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`${command} falhou: ${result.error?.message || result.stderr}`);
}

try {
  const socket = createServer();
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  run('initdb', ['-D', folder, '-U', 'mes_test_admin', '--auth=trust', '--no-locale', '--encoding=UTF8']);
  run('pg_ctl', ['-D', folder, '-l', join(folder, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ''`, '-w', 'start']);
  started = true;
  const result = spawnSync(process.execPath, ['--test', 'test/integration.mjs'], {
    cwd: new URL('..', import.meta.url),
    stdio: 'inherit',
    timeout: 60000,
    env: { ...process.env, MES_TEST_DATABASE_URL: `postgresql://mes_test_admin@127.0.0.1:${port}/postgres` },
  });
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (started) run('pg_ctl', ['-D', folder, '-m', 'fast', '-w', 'stop']);
  rmSync(folder, { recursive: true, force: true });
}
