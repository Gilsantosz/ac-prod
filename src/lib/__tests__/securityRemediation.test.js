import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveReportCellScope } from '../../../supabase/functions/_shared/reportAccessScope.ts';
import {
  assertTrustedPromobUrl,
  canonicalPromobOrigin,
} from '../../../supabase/functions/_shared/promobSecurity.ts';
import { genericRecoveryBody } from '../../../supabase/functions/_shared/recoveryResponse.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('service-role report cell scope', () => {
  it('fails closed for a non-admin without any assigned cell', () => {
    expect(() => resolveReportCellScope({ role: 'manager', managed_cells: [], cell: null }))
      .toThrow('ACCESS_DENIED');
  });

  it('rejects a requested cell outside the caller scope', () => {
    expect(() => resolveReportCellScope(
      { role: 'manager', managed_cells: ['Corte'] },
      ['Embalagem'],
    )).toThrow('ACCESS_DENIED');
  });

  it('keeps an explicit unrestricted state exclusively for admins', () => {
    expect(resolveReportCellScope({ role: 'admin' })).toEqual({ unrestricted: true, cells: [] });
    expect(resolveReportCellScope({ role: 'admin' }, ['Corte']))
      .toEqual({ unrestricted: false, cells: ['Corte'] });
  });
});

describe('Promob secret-bearing destination policy', () => {
  it('accepts only an explicitly trusted exact HTTPS origin', () => {
    const url = assertTrustedPromobUrl(
      'https://api.promob.example/v1/orders',
      ['https://api.promob.example'],
    );
    expect(url.origin).toBe('https://api.promob.example');
  });

  it.each([
    'http://api.promob.example/orders',
    'https://127.0.0.1/orders',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.8/orders',
    'https://localhost/orders',
    'https://user:password@api.promob.example/orders',
    'https://api.promob.example:8443/orders',
  ])('rejects unsafe target %s', (target) => {
    expect(() => canonicalPromobOrigin(target)).toThrow();
  });

  it('rejects an attacker origin before it can be used', () => {
    expect(() => assertTrustedPromobUrl(
      'https://attacker.example/collect',
      ['https://api.promob.example'],
    )).toThrow('PROMOB_ORIGIN_NOT_TRUSTED');
  });
});

describe('password recovery public response', () => {
  it('uses one immutable public body for every account-dependent outcome', () => {
    expect(genericRecoveryBody()).toEqual({
      success: true,
      message: 'Se o e-mail estiver cadastrado, as instruções foram processadas.',
    });
    expect(genericRecoveryBody()).not.toBe(genericRecoveryBody());
  });
});

describe('SQL authorization regression guards', () => {
  const migrationName = fs.readdirSync(path.join(repoRoot, 'supabase/migrations'))
    .find((name) => name.endsWith('_security_scan_remediation_11_findings.sql'));
  const migration = read(`supabase/migrations/${migrationName}`);

  it('uses a fixed inactive least-privilege profile bootstrap', () => {
    expect(migration).not.toContain("raw_user_meta_data->>'role'");
    expect(migration).not.toContain("raw_user_meta_data->>'permissions'");
    expect(migration).toMatch(/'operator',\s*'\{\}'::jsonb,\s*false/);
  });

  it('keeps privileged RPC implementations private and checks capability plus cell scope', () => {
    expect(migration).toContain('register_quality_rejection_impl');
    expect(migration).toContain('public.can_manage_quality()');
    expect(migration).toContain('QUALITY_OUTSIDE_CELL_SCOPE');
    expect(migration).toContain('public.can_manage_occurrences()');
    expect(migration).toContain('OCCURRENCE_OUTSIDE_CELL_SCOPE');
    expect(migration).toContain('MANUAL_PRODUCTION_OUTSIDE_CELL_SCOPE');
    expect(migration).not.toContain('v_cell_by_id record');
    expect(migration).toMatch(/production_stage_readings reading\s+join public\.cells cell/);
    expect(migration).not.toContain("auth.role() <> 'service_role'");
    expect(migration).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(migration).toMatch(/revoke all on function public\.register_quality_rejection_impl\(jsonb\)[\s\S]*from public, anon, authenticated/);
  });

  it('binds operator tokens and destructive reset to the active authenticated profile', () => {
    expect(migration).toContain('session.auth_user_id = v_auth_user_id');
    expect(migration).toMatch(/where auth_user_id is null[\s\S]*and revoked_at is null/);
    expect(migration).toContain("public.get_my_role() is distinct from 'admin'");
  });
});

describe('retired Base44 privileged handlers', () => {
  const handlers = [
    'syncSupabaseProduction',
    'createCriticalIssue',
    'notifyDowntimeAlert',
    'sendDailyClosure',
    'checkLowEfficiencyAlerts',
  ];

  it.each(handlers)('%s is fail-closed and contains no privileged connector call', (name) => {
    const source = read(`base44/functions/${name}/entry.ts`);
    expect(source).toContain('LEGACY_HANDLER_DISABLED');
    expect(source).toContain('status: 410');
    expect(source).not.toContain('connectors.getConnection');
    expect(source).not.toContain('asServiceRole');
  });
});

describe('Edge source ordering and redirect policy', () => {
  it('authorizes the Promob origin before decrypting the token and disables redirects', () => {
    const source = read('supabase/functions/promob-api-sync/index.ts');
    expect(source.indexOf('assertTrustedPromobUrl')).toBeLessThan(source.indexOf('get_promob_token'));
    expect(source).toContain('redirect: "error"');
    expect(source).toContain('.select("role, active")');
  });

  it('maps active and provider-error recovery paths to the same generic response', () => {
    const source = read('supabase/functions/recover-password/index.ts');
    expect(source).not.toContain('Instruções de recuperação enviadas com sucesso.');
    expect(source).toContain('if (hasValidEmailInput) return await genericSuccess()');
    expect(source).toContain('waitForComparableRecoveryTiming');
  });
});
