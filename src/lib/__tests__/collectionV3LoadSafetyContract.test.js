import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadPath = 'tests/load/collection-fabric-v3.js';
const runbookPath = 'docs/runbooks/collection-fabric-v3-deploy.md';
const load = readFileSync(resolve(process.cwd(), loadPath), 'utf8');
const runbook = readFileSync(resolve(process.cwd(), runbookPath), 'utf8');

const projectRef = 'uozuzdfvnufsjsonswag';
const productionUrl = `https://${projectRef}.supabase.co`;
const destructiveConfirmation =
  `EU-AUTORIZO-ESCRITAS-K6-DESTRUTIVAS-NO-ACPROD-TESTE-${projectRef}`;

describe('Collection Fabric v3 k6 target safety contract', () => {
  it('preserves the existing staging confirmation and excludes the authorized project', () => {
    expect(load).toContain("target === 'staging'");
    expect(load).toContain("writesConfirmation !== 'staging-v3-load'");
    expect(load).toContain('supabaseUrl.includes(productionProjectRef)');
  });

  it('allows only the exact authorized test-production triple lock', () => {
    expect(load).toContain(`const productionProjectRef = '${projectRef}'`);
    expect(load).toContain(
      'const authorizedTestProductionUrl = `https://${productionProjectRef}.supabase.co`',
    );
    expect(load).toContain(`'${destructiveConfirmation}'`);
    expect(load).toContain("const target = __ENV.K6_TARGET || ''");
    expect(load).toContain("target === 'test-production'");
    expect(load).toContain('supabaseUrl !== authorizedTestProductionUrl');
    expect(load).toContain('writesConfirmation !== authorizedTestProductionConfirmation');
    expect(load).not.toContain('K6_ALLOW_PRODUCTION');
    expect(load).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('rejects code offsets because every fixture is bound to one exact profile/run', () => {
    expect(load).toContain('requestedCodeOffset !== 0');
    expect(load).toContain('K6_CODE_OFFSET não é suportado');
    expect(load).not.toContain('codes[globalCodeOffset');
  });

  it('documents the exact target, URL and destructive confirmation without weakening staging', () => {
    expect(runbook).toContain('K6_TARGET="staging"');
    expect(runbook).toContain('K6_CONFIRM_WRITES="staging-v3-load"');
    expect(runbook).toContain('K6_TARGET="test-production"');
    expect(runbook).toContain(`SUPABASE_URL="${productionUrl}"`);
    expect(runbook).toContain(`K6_CONFIRM_WRITES="${destructiveConfirmation}"`);
    expect(runbook).toContain('ESCRITAS DESTRUTIVAS');
    expect(runbook).toContain('não possui limpeza automática');
  });
});
