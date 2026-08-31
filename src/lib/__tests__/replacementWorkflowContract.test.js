import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('AC.Prod2 replacement workflow v8.2 contract', () => {
  it('aprova diretamente sem modal, senha, justificativa ou células automáticas', () => {
    const modal = repoFile('src/components/replacement/ReplacementApproveModal.jsx');
    const service = repoFile('src/lib/replacementApprovalService.js');

    expect(modal).toContain('approveReplacement(orderId)');
    expect(modal).not.toContain('<Dialog');
    expect(modal).not.toContain('selectedCells');
    expect(modal).not.toContain('type="password"');
    expect(service).toContain("approvalMode: 'station_queue'");
    expect(service).toContain('automaticEntriesSupported: false');
    expect(service).not.toContain('selected_cells:');
  });

  it('mantém conclusão forçada sem senha e com justificativa obrigatória', () => {
    const modal = repoFile('src/components/replacement/ReplacementForceCompleteModal.jsx');

    expect(modal).toContain('Justificativa obrigatória');
    expect(modal).toContain('Nenhuma senha adicional é solicitada');
    expect(modal).toContain('reason.trim()');
    expect(modal).not.toContain('type="password"');
    expect(modal).not.toContain('adminPassword');
  });

  it('destaca dimensões, material/cor e espessura no posto por célula', () => {
    const station = repoFile('src/pages/ReplacementStationPage.jsx');

    expect(station).toContain('replacement-station-technical-specs');
    expect(station).toContain('Dimensões da peça');
    expect(station).toContain('Material / cor');
    expect(station).toContain('Espessura');
    expect(station).toContain('Peça substituta para produzir');
  });

  it('disponibiliza o papel Qualidade na hierarquia e no backend de usuários', () => {
    const roles = repoFile('src/lib/roleProfiles.js');
    const createUser = repoFile('src/components/users/CreateUserModal.jsx');
    const edge = repoFile('supabase/functions/admin-users/index.ts');

    expect(roles).toContain("value: 'quality_manager'");
    expect(roles).toContain('force_complete_replacements: true');
    expect(createUser).toContain('SYSTEM_ROLE_OPTIONS');
    expect(edge).toContain("'quality_manager'");
    expect(edge).toContain('quality_manager: 25');
  });

  it('versiona o contrato do banco e bloqueia deploy incompatível', () => {
    const migration = 'supabase/migrations/20260831135630_finalize_replacement_workflow_v8_2.sql';
    const workflow = repoFile('.github/workflows/deploy.yml');

    expect(existsSync(resolve(process.cwd(), migration))).toBe(true);
    expect(repoFile(migration)).toContain('20260831_acprod_replacement_v8_2');
    expect(workflow).toContain('REQUIRED_MIGRATION_VERSION: "20260831135630"');
    expect(workflow).toContain('REQUIRED_RELEASE_VERSION: "20260831_acprod_replacement_v8_2"');
    expect(workflow).toContain('replacement_station_only_approval');
    expect(workflow).toContain('replacement_force_justification_only');
  });
});
