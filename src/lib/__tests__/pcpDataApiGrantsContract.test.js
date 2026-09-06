import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/20260906144111_repair_pcp_authenticated_grants.sql',
), 'utf8');

describe('PCP Data API grants contract', () => {
  it('fails closed if a PCP table is missing or does not have RLS', () => {
    expect(migration).toContain("and c.relkind in ('r', 'p')");
    expect(migration).toContain('if rls_enabled is distinct from true then');
    expect(migration).toContain('Refusing PCP grant');
  });

  it('lets authenticated requests reach every PCP table policy', () => {
    expect(migration).toContain('grant usage on schema public to authenticated');
    expect(migration).toContain('grant select, insert, update, delete on table');
    expect(migration).toContain('public.production_orders');
    expect(migration).toContain('public.production_lots');
    expect(migration).toContain('public.production_stage_readings');
    expect(migration).toContain('public.promob_import_batches');
    expect(migration).toContain('public.pcp_import_logs');
    expect(migration).toContain('public.pcp_import_rows');
    expect(migration).toContain('public.backup_files');
    expect(migration).toContain('public.pcp_integration_settings');
    expect(migration).toMatch(/to authenticated;\s*$/);
  });

  it('does not grant access to anonymous clients or bypass RLS', () => {
    expect(migration).not.toMatch(/\bto\s+(?:anon|public)\b/i);
    expect(migration).not.toMatch(/disable\s+row\s+level\s+security/i);
    expect(migration).not.toMatch(/service_role/i);
  });
});
