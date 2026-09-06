import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertIsolatedCollectionTarget,
  assertVerifiedCollectionSession,
  ISOLATED_COLLECTION_TEST_URL,
  validateCollectionIdentities,
} from '../../../tests/load/collection-load-preflight.js';

const load = readFileSync(resolve(process.cwd(), 'tests/load/collection-fabric-v3.js'), 'utf8');
const runbook = readFileSync(resolve(process.cwd(), 'docs/runbooks/collection-fabric-v3-deploy.md'), 'utf8');
const now = Date.parse('2026-09-06T22:00:00Z');
const id = (value) => `00000000-0000-4000-a000-${String(value).padStart(12, '0')}`;
const requirement = { devices: 2, cells: 2 };
const fixture = () => ({
  devices: [1, 2].map((value) => ({
    device_id: id(value), operator_session_id: id(value + 10),
    cell_id: id(value + 20), machine_id: id(value + 30), access_token: String(value),
  })),
  codes: ['00000001', '00000002'],
  code_cells: { '00000001': id(21), '00000002': id(22) },
});
const decode = (token) => ({
  sub: id(Number(token) + 100), role: 'authenticated',
  iss: `${ISOLATED_COLLECTION_TEST_URL}/auth/v1`, exp: (now / 1000) + 3600,
});

describe('Collection Fabric v3 isolated load preflight', () => {
  it('allows only the exact isolated project with write confirmation', () => {
    expect(() => assertIsolatedCollectionTarget(ISOLATED_COLLECTION_TEST_URL, 'staging', 'staging-v3-load')).not.toThrow();
    for (const url of ['https://uozuzdfvnufsjsonswag.supabase.co', `${ISOLATED_COLLECTION_TEST_URL}.evil.invalid`, 'https://other.supabase.co']) {
      expect(() => assertIsolatedCollectionTarget(url, 'staging', 'staging-v3-load')).toThrow('Carga bloqueada');
    }
    expect(() => assertIsolatedCollectionTarget(ISOLATED_COLLECTION_TEST_URL, 'test-production', 'staging-v3-load')).toThrow();
    expect(() => assertIsolatedCollectionTarget(ISOLATED_COLLECTION_TEST_URL, 'staging', '')).toThrow();
  });

  it('requires actual distinct identities, sessions and declared cells', () => {
    expect(validateCollectionIdentities(fixture(), requirement, decode, now)).toEqual({ users: 2, sessions: 2, devices: 2, cells: 2 });
    const sameUser = fixture(); sameUser.devices[1].access_token = '1';
    expect(() => validateCollectionIdentities(sameUser, requirement, decode, now)).toThrow('distintos');
    const sameSession = fixture(); sameSession.devices[1].operator_session_id = sameSession.devices[0].operator_session_id;
    expect(() => validateCollectionIdentities(sameSession, requirement, decode, now)).toThrow('distintos');
  });

  it('does not accept an anonymous/service-role, expired or different-project token', () => {
    for (const override of [
      { role: 'service_role' }, { role: 'anon' }, { exp: now / 1000 + 60 },
      { iss: 'https://uozuzdfvnufsjsonswag.supabase.co/auth/v1' },
    ]) {
      expect(() => validateCollectionIdentities(fixture(), requirement, (token) => ({ ...decode(token), ...override }), now)).toThrow('JWT de usuario');
    }
  });

  it('fails malformed JWT decoding without leaking its value', () => {
    const value = fixture(); value.devices[0].access_token = 'secret-value-never-print';
    try { validateCollectionIdentities(value, requirement, () => { throw new Error('secret-value-never-print'); }, now); }
    catch (error) { expect(error.message).not.toContain('secret-value-never-print'); }
    expect(() => validateCollectionIdentities(value, requirement, () => null, now)).toThrow('JWT de usuario');
  });

  it('refuses a single cell as multicell proof or unassigned piece codes', () => {
    const sameCell = fixture(); sameCell.devices[1].cell_id = sameCell.devices[0].cell_id;
    expect(() => validateCollectionIdentities(sameCell, requirement, decode, now)).toThrow('2 celulas');
    const noRouting = fixture(); delete noRouting.code_cells;
    expect(() => validateCollectionIdentities(noRouting, requirement, decode, now)).toThrow('code_cells');
  });

  it('requires server-verified auth ownership and operational scope without bypassing RLS', () => {
    const device = fixture().devices[0];
    const user = { id: id(101) };
    const session = { id: device.operator_session_id, auth_user_id: user.id, cell_id: device.cell_id, machine_id: device.machine_id, expires_at: new Date(now + 3600000).toISOString() };
    expect(() => assertVerifiedCollectionSession(device, user, session, now)).not.toThrow();
    for (const override of [{ auth_user_id: id(102) }, { cell_id: id(22) }, { revoked_at: new Date(now).toISOString() }, { expires_at: 'invalid' }]) {
      expect(() => assertVerifiedCollectionSession(device, user, { ...session, ...override }, now)).toThrow('Preflight remoto recusado');
    }
  });

  it('verifies users and sessions before ingress and does not promote a production escape hatch', () => {
    expect(load).toContain('/auth/v1/user');
    expect(load).toContain('/rest/v1/operator_sessions?select=');
    expect(load).toContain('assertVerifiedCollectionSession');
    expect(load).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(load).not.toContain('authorizedTestProduction');
    expect(runbook).toContain(`SUPABASE_URL="${ISOLATED_COLLECTION_TEST_URL}"`);
    expect(runbook).toContain('K6_CONFIRM_WRITES="staging-v3-load"');
    expect(runbook).toMatch(/não possui limpeza\s+automática/);
  });
});
