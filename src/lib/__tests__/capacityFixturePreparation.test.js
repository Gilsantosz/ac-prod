import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

function uuidFor(value) {
  const suffix = Number(value).toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-4000-8000-${suffix}`;
}

function runScript(args, env, stdin) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectPromise);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(new Error(`fixture script exited ${code}: ${stderr}`));
    });
    child.stdin.end(stdin);
  });
}

describe('capacity fixture preparation', () => {
  it('paginates 18,000 codes and creates 100 distinct authenticated device sessions', async () => {
    let authUsers = 0;
    let operatorSessions = 0;
    let piecePages = 0;
    const server = createServer((request, response) => {
      request.resume();
      const url = new URL(request.url, 'http://127.0.0.1');
      response.setHeader('Content-Type', 'application/json');

      if (url.pathname === '/rest/v1/rpc/prepare_capacity_atomic_contexts_v3') {
        response.end('{}');
        return;
      }
      if (url.pathname === '/rest/v1/rpc/get_capacity_fixture_contexts_v4') {
        response.end(JSON.stringify({
          cut_cell: { id: uuidFor(1), name: 'Corte' },
          atomic_machine: { id: uuidFor(2), name: 'CAPTEST_ATOMIC' },
          contention_machines: [],
        }));
        return;
      }
      if (url.pathname === '/rest/v1/production_pieces') {
        piecePages += 1;
        const offset = Number(url.searchParams.get('offset'));
        const rows = Array.from(
          { length: Math.max(0, Math.min(1000, 18_000 - offset)) },
          (_, index) => ({
            traceability_code: String(offset + index + 1).padStart(8, '0'),
            lot_id: uuidFor(3),
            sequence_number: offset + index + 1,
          }),
        );
        response.end(JSON.stringify(rows));
        return;
      }
      if (url.pathname === '/auth/v1/admin/users' && request.method === 'POST') {
        authUsers += 1;
        response.end(JSON.stringify({ id: uuidFor(100 + authUsers) }));
        return;
      }
      if (url.pathname === '/rest/v1/profiles' && request.method === 'PATCH') {
        response.statusCode = 204;
        response.end();
        return;
      }
      if (url.pathname === '/auth/v1/token') {
        response.end(JSON.stringify({
          access_token: `access-token-${authUsers}`,
          refresh_token: `refresh-token-${authUsers}`,
        }));
        return;
      }
      if (url.pathname === '/rest/v1/rpc/operator_login_v2') {
        operatorSessions += 1;
        response.end(JSON.stringify({
          success: true,
          session_id: uuidFor(1000 + operatorSessions),
          session_token: `operator-token-${operatorSessions}`,
          operator: {
            cells: [{ id: uuidFor(10), name: 'Corte', is_primary: true }],
            machines: [{ id: uuidFor(11), name: 'Primary', is_primary: true }],
          },
        }));
        return;
      }
      if (url.pathname === '/rest/v1/rpc/set_operator_session_context') {
        response.end(JSON.stringify({ success: true }));
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ code: 'NOT_FOUND' }));
    });
    await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));

    const directory = await mkdtemp(resolve(tmpdir(), 'acprod-capacity-fixture-'));
    temporaryDirectories.push(directory);
    const credentialsPath = resolve(directory, 'credentials.json');
    const fixturePath = resolve(directory, 'nominal.json');
    await writeFile(credentialsPath, JSON.stringify({
      credentials: Array.from({ length: 14 }, (_, index) => ({
        login_name: `operator-${index + 1}`,
        registration: `registration-${index + 1}`,
      })),
    }), { mode: 0o600 });

    try {
      const address = server.address();
      const stdout = await runScript([
        'tests/capacity/prepare-auth-fixture.mjs',
        'CAPTEST_20260903_150000_A1B2C3D4',
        'nominal',
        credentialsPath,
        fixturePath,
      ], {
        PATH: process.env.PATH,
        SUPABASE_URL: `http://127.0.0.1:${address.port}`,
        SUPABASE_ANON_KEY: 'public-value',
      }, JSON.stringify([{ name: 'service_role', api_key: 'server-value' }]));

      const result = JSON.parse(stdout);
      const rawFixture = await readFile(fixturePath, 'utf8');
      const fixture = JSON.parse(rawFixture);
      expect(result).toMatchObject({ profile: 'nominal', devices: 100, codes: 18_000 });
      expect(authUsers).toBe(8);
      expect(operatorSessions).toBe(100);
      expect(piecePages).toBe(19);
      expect(new Set(fixture.devices.map((device) => device.device_id)).size).toBe(100);
      expect(new Set(fixture.devices.map((device) => device.operator_session_id)).size).toBe(100);
      expect(fixture.codes).toHaveLength(18_000);
      expect(rawFixture).not.toContain('server-value');
      expect((await stat(fixturePath)).mode & 0o777).toBe(0o600);
    } finally {
      await new Promise((resolvePromise) => server.close(resolvePromise));
    }
  }, 20_000);
});
