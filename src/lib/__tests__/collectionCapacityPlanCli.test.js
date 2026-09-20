import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ISOLATED_COLLECTION_TEST_URL } from '../../../tests/load/collection-load-preflight.js';

const folders = [];
const id = (value) => `00000000-0000-4000-a000-${String(value).padStart(12, '0')}`;

function token() {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: id(10),
    role: 'authenticated',
    iss: `${ISOLATED_COLLECTION_TEST_URL}/auth/v1`,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  return `${header}.${payload}.never-log-this-signature`;
}

function fixtureFile() {
  const folder = mkdtempSync(join(tmpdir(), 'acprod-capacity-plan-'));
  folders.push(folder);
  const path = join(folder, 'fixture.json');
  writeFileSync(path, JSON.stringify({
    devices: [{
      device_id: id(1),
      operator_session_id: id(2),
      cell_id: id(3),
      machine_id: id(4),
      access_token: token(),
    }],
    codes: ['00000001'],
    code_cells: { '00000001': id(3) },
  }));
  return path;
}

function environment(path, url = ISOLATED_COLLECTION_TEST_URL) {
  return {
    ...process.env,
    SUPABASE_URL: url,
    K6_TARGET: 'staging',
    K6_CONFIRM_WRITES: 'staging-v3-load',
    K6_PROFILE: 'smoke',
    K6_RUN_ID: 'smoke-plan-r1',
    K6_SEQUENCE_BASE: '1000000',
    K6_CODE_OFFSET: '0',
    K6_FIXTURES: path,
  };
}

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('offline collection capacity plan', () => {
  it('validates the real fixture shape without sending a remote request or exposing JWTs', () => {
    const path = fixtureFile();
    const output = execFileSync(
      process.execPath,
      [resolve(process.cwd(), 'scripts/mes/plan-collection-capacity.mjs')],
      { cwd: process.cwd(), env: environment(path), encoding: 'utf8' },
    );
    const result = JSON.parse(output);
    expect(result).toMatchObject({
      mode: 'offline_plan_only',
      remote_requests_sent: 0,
      profile: 'smoke',
      ingress_rpc: 'ingest_collection_batch_immediate_v3',
      maximum_events_per_request: 5,
      execute_next: false,
    });
    expect(result.fixture_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(output).not.toContain('never-log-this-signature');
  });

  it('refuses the production project before any load can start', () => {
    const path = fixtureFile();
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), 'scripts/mes/plan-collection-capacity.mjs')],
      {
        cwd: process.cwd(),
        env: environment(path, 'https://uozuzdfvnufsjsonswag.supabase.co'),
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Carga bloqueada');
    expect(result.stderr).not.toContain('never-log-this-signature');
  });
});
