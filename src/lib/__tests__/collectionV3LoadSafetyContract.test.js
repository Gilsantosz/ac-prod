import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertIsolatedCollectionTarget,
  assertProductionCollectionReadOnlyTarget,
  assertVerifiedCollectionSession,
  COLLECTION_LOAD_PROFILE_REQUIREMENTS,
  ISOLATED_COLLECTION_TEST_URL,
  PRODUCTION_COLLECTION_URL,
  isFreshCollectionImmediateSnapshot,
  validateCollectionCodeWindow,
  validateCollectionIdentities,
} from '../../../tests/load/collection-load-preflight.js';

const load = readFileSync(resolve(process.cwd(), 'tests/load/collection-fabric-v3.js'), 'utf8');
const productionReadOnly = readFileSync(resolve(process.cwd(), 'tests/load/collection-production-readonly.js'), 'utf8');
const productionDiagnostic = readFileSync(resolve(process.cwd(), 'tests/load/collection-production-readonly-diagnostic.js'), 'utf8');
const runbook = readFileSync(resolve(process.cwd(), 'docs/runbooks/collection-fabric-v3-deploy.md'), 'utf8');
const now = Date.parse('2026-09-06T22:00:00Z');
const id = (value) => `00000000-0000-4000-a000-${String(value).padStart(12, '0')}`;
const requirement = { devices: 2, cells: 2, machines: 2, devicesPerCell: 1, machinesPerCell: 1 };
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
  it('rejects expired, malformed, or future public snapshots even when marked fresh', () => {
    const valid = {
      snapshot_format: 'collection_immediate_release_snapshot_v1',
      snapshot_status: 'fresh',
      snapshot_refreshed_at: new Date(now - 30000).toISOString(),
      snapshot_expires_at: new Date(now + 150000).toISOString(),
    };
    expect(isFreshCollectionImmediateSnapshot(valid, now)).toBe(true);
    for (const change of [
      { snapshot_status: 'expired' }, { snapshot_format: 'unknown' },
      { snapshot_refreshed_at: 'invalid' }, { snapshot_expires_at: 'invalid' },
      { snapshot_expires_at: new Date(now).toISOString() },
      { snapshot_refreshed_at: new Date(now + 6000).toISOString() },
      { snapshot_expires_at: new Date(now + 180000).toISOString() },
    ]) expect(isFreshCollectionImmediateSnapshot({ ...valid, ...change }, now)).toBe(false);
  });
  it('allows only the exact isolated project with write confirmation', () => {
    expect(() => assertIsolatedCollectionTarget(ISOLATED_COLLECTION_TEST_URL, 'staging', 'staging-v3-load')).not.toThrow();
    for (const url of ['https://uozuzdfvnufsjsonswag.supabase.co', `${ISOLATED_COLLECTION_TEST_URL}.evil.invalid`, 'https://other.supabase.co']) {
      expect(() => assertIsolatedCollectionTarget(url, 'staging', 'staging-v3-load')).toThrow('Carga bloqueada');
    }
    expect(() => assertIsolatedCollectionTarget(ISOLATED_COLLECTION_TEST_URL, 'test-production', 'staging-v3-load')).toThrow();
    expect(() => assertIsolatedCollectionTarget(ISOLATED_COLLECTION_TEST_URL, 'staging', '')).toThrow();
  });

  it('allows the production project only through the explicit read-only gate profile', () => {
    expect(() => assertProductionCollectionReadOnlyTarget(
      PRODUCTION_COLLECTION_URL,
      'production-readonly',
      'production-gate-readonly-40rps',
    )).not.toThrow();
    expect(() => assertProductionCollectionReadOnlyTarget(
      ISOLATED_COLLECTION_TEST_URL,
      'production-readonly',
      'production-gate-readonly-40rps',
    )).toThrow('Leitura bloqueada');
    expect(() => assertProductionCollectionReadOnlyTarget(
      PRODUCTION_COLLECTION_URL,
      'production',
      'production-gate-readonly-40rps',
    )).toThrow();
  });

  it('requires actual distinct identities, sessions and declared cells', () => {
    expect(validateCollectionIdentities(fixture(), requirement, decode, now)).toEqual({ users: 2, sessions: 2, devices: 2, cells: 2, machines: 2 });
    const sameUser = fixture(); sameUser.devices[1].access_token = '1';
    expect(() => validateCollectionIdentities(sameUser, requirement, decode, now)).toThrow('distintos');
    const sameSession = fixture(); sameSession.devices[1].operator_session_id = sameSession.devices[0].operator_session_id;
    expect(() => validateCollectionIdentities(sameSession, requirement, decode, now)).toThrow('distintos');
    const sameMachine = fixture(); sameMachine.devices[1].machine_id = sameMachine.devices[0].machine_id;
    expect(() => validateCollectionIdentities(sameMachine, requirement, decode, now)).toThrow('postos distintos');
  });

  it('does not accept an anonymous/service-role, expired or different-project token', () => {
    for (const override of [
      { role: 'service_role' }, { role: 'anon' }, { exp: now / 1000 + 60 },
      { iss: 'https://uozuzdfvnufsjsonswag.supabase.co/auth/v1' },
    ]) {
      expect(() => validateCollectionIdentities(fixture(), requirement, (token) => ({ ...decode(token), ...override }), now)).toThrow('JWT de usuario');
    }
    expect(() => validateCollectionIdentities(
      fixture(),
      { ...requirement, tokenValidityMinutes: 45 },
      (value) => ({ ...decode(value), exp: (now / 1000) + (30 * 60) }),
      now,
    )).toThrow('45 minutos');
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
    expect(() => validateCollectionCodeWindow(noRouting, 'smoke', 0)).not.toThrow();

    const nominalRequirement = COLLECTION_LOAD_PROFILE_REQUIREMENTS.nominal;
    const nominal = {
      devices: Array.from({ length: nominalRequirement.devices }, (_, index) => ({
        device_id: id(index + 1000),
        operator_session_id: id(index + 3000),
        cell_id: id(5000 + (index % 2)),
        machine_id: id(6000 + (index % 4)),
        access_token: String(index + 1),
      })),
      codes: Array.from({ length: nominalRequirement.codes }, (_, index) => String(index + 1).padStart(8, '0')),
      code_cells: {},
    };
    for (let index = 0; index < nominal.codes.length; index += 1) {
      nominal.code_cells[nominal.codes[index]] = nominal.devices[index % nominal.devices.length].cell_id;
    }
    expect(validateCollectionCodeWindow(nominal, 'nominal', 0)).toEqual({
      codeOffset: 0,
      codes: nominalRequirement.codes,
      segments: 1,
    });
    delete nominal.code_cells[nominal.codes[10]];
    expect(() => validateCollectionCodeWindow(nominal, 'nominal', 0)).toThrow('sem destino');
  });

  it('reserva uma janela exclusiva de codigos e detecta roteamento cruzado antes de gravar', () => {
    const value = fixture();
    value.codes = ['99999999', ...value.codes];
    value.code_cells['99999999'] = value.devices[0].cell_id;
    expect(validateCollectionCodeWindow(value, 'smoke', 1)).toEqual({ codeOffset: 1, codes: 1, segments: 1 });
    value.code_cells['00000001'] = value.devices[1].cell_id;
    expect(() => validateCollectionCodeWindow(value, 'smoke', 1)).toThrow('roteamento');
    expect(() => validateCollectionCodeWindow(value, 'smoke', -1)).toThrow('K6_CODE_OFFSET');
  });

  it('requires server-verified auth ownership and operational scope without bypassing RLS', () => {
    const device = fixture().devices[0];
    const user = { id: id(101) };
    const session = { id: device.operator_session_id, auth_user_id: user.id, cell_id: device.cell_id, machine_id: device.machine_id, device_id: device.device_id, expires_at: new Date(now + 3600000).toISOString() };
    expect(() => assertVerifiedCollectionSession(device, user, session, now)).not.toThrow();
    for (const override of [{ auth_user_id: id(102) }, { cell_id: id(22) }, { device_id: id(99) }, { revoked_at: new Date(now).toISOString() }, { expires_at: 'invalid' }]) {
      expect(() => assertVerifiedCollectionSession(device, user, { ...session, ...override }, now)).toThrow('Preflight remoto recusado');
    }
  });

  it('verifies users and sessions before ingress and does not promote a production escape hatch', () => {
    expect(load).toContain('/auth/v1/user');
    expect(load).toContain('/rest/v1/operator_sessions?select=');
    expect(load).toContain('assertVerifiedCollectionSession');
    expect(load).toContain("const ingressRpc = 'ingest_collection_batch_immediate_v3'");
    expect(load).toContain("rpc('get_public_collection_immediate_release'");
    expect(load).toContain('global_40_events_per_second');
    expect(load).not.toContain('thousand_private_device_connections');
    expect(load).toContain('K6_CODE_OFFSET');
    expect(load).toContain('verifyRemoteIdentities');
    expect(load).toContain('assertUnusedRunNamespace');
    expect(load).not.toContain("rpc(\n      'ingest_collection_batch_v3'");
    expect(load).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(load).not.toContain('authorizedTestProduction');
    expect(productionReadOnly).toContain('thousand_logical_devices_http_readonly');
    expect(productionReadOnly).toContain('public_gate_readonly_short_ramp');
    expect(productionReadOnly).toContain('K6_READONLY_PROFILE');
    expect(productionReadOnly).toContain("startRate: 10");
    expect(productionReadOnly).toContain("{ duration: '1m', target: 35 }");
    expect(productionReadOnly).toContain("{ duration: '1m', target: 40 }");
    expect(productionReadOnly).toContain("http.get(gateUrl");
    expect(productionReadOnly).not.toContain('/rpc/ingest_');
    expect(productionReadOnly).not.toContain('http.post');
    expect(productionReadOnly).toContain('abortOnFail: true');
    expect(productionReadOnly).toContain("delayAbortEval: '30s'");
    expect(productionDiagnostic).toContain('/auth/v1/health');
    expect(productionDiagnostic).toContain('/rest/v1/rpc/get_public_collection_immediate_release');
    expect(productionDiagnostic).toContain("auth_health_1rps: stepScenario('auth_health', 1");
    expect(productionDiagnostic).toContain("auth_health_5rps: stepScenario('auth_health', 5");
    expect(productionDiagnostic).toContain("public_gate_10rps: stepScenario('public_gate', 10");
    expect(productionDiagnostic).toContain("public_gate_15rps: stepScenario('public_gate', 15");
    expect(productionDiagnostic).toContain('abortOnFail: true');
    expect(productionDiagnostic).not.toContain('http.post');
    expect(productionDiagnostic).not.toContain('http.put');
    expect(productionDiagnostic).not.toContain('http.patch');
    expect(productionDiagnostic).not.toContain('http.del');
    expect(productionDiagnostic).not.toContain('/rpc/ingest_');
    expect(runbook).toContain(`SUPABASE_URL="${ISOLATED_COLLECTION_TEST_URL}"`);
    expect(runbook).toContain('K6_CONFIRM_WRITES="staging-v3-load"');
    expect(runbook).toMatch(/não possui limpeza\s+automática/);
  });
});
