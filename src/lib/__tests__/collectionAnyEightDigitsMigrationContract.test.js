import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260906150000_accept_any_eight_digit_collection_code.sql',
);
const sloMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260906150100_relax_test_collection_projection_slo.sql',
);
const hardeningMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260906150200_harden_collection_stage_facts_access.sql',
);

describe('contrato SQL da numeração produtiva de oito dígitos', () => {
  const migration = readFileSync(migrationPath, 'utf8');

  it('extrai somente dígitos ASCII sem converter o valor para número', () => {
    expect(migration).toContain("regexp_replace(p_value, '[^0-9]', '', 'g')");
    expect(migration).toContain("digits ~ '^[0-9]{8}$'");
    expect(migration).not.toMatch(/::(?:big)?int/);
  });

  it('mantém a função disponível apenas para os papéis autorizados', () => {
    expect(migration).toContain('FROM PUBLIC, anon');
    expect(migration).toContain('TO authenticated, service_role');
    expect(migration).toContain("NOTIFY pgrst, 'reload schema'");
  });

  it('permite ao PostgREST alcançar os recibos somente atrás da RLS', () => {
    expect(migration).toContain('relation.relrowsecurity IS TRUE');
    expect(migration).toContain('REVOKE ALL ON TABLE public.coletas_producao FROM anon');
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.coletas_producao');
  });
});

describe('SLO de projeção da homologação', () => {
  const migration = readFileSync(sloMigrationPath, 'utf8');

  it('altera somente o perfil test e protege os limites de produção', () => {
    expect(migration).toContain("WHERE profile_name = 'test'");
    expect(migration).toContain('SET projection_p95_ms = 3000');
    expect(migration).toContain("profile_name = 'production'");
    expect(migration).toContain('AND projection_p95_ms = 500');
  });
});

describe('hardening dos fatos consolidados', () => {
  const migration = readFileSync(hardeningMigrationPath, 'utf8');

  it('usa os privilégios e o search_path do chamador de forma explícita', () => {
    expect(migration).toContain('SET (security_invoker = true)');
    expect(migration).toContain('SET search_path = pg_catalog, public, extensions');
    expect(migration).toContain('SET search_path = pg_catalog, public');
  });
});
