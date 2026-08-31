import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('AC.Prod2 replacement workflow v8.4 contract', () => {
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

  it('reconcilia a migração concorrente com hierarquia estrita e auditoria dupla', () => {
    const migration = repoFile('supabase/migrations/20260831143323_reconcile_replacement_workflow_v8_3.sql');

    expect(migration).toContain('current_profile_can_decide_replacement');
    expect(migration).toContain('replacement_origin_classification');
    expect(migration).toContain('manual_adjustment');
    expect(migration).toContain('conclusao_forcada_reposicao');
    expect(migration).toContain('mirror_replacement_action_audit_to_system_logs');
    expect(migration).toContain('trg_mirror_replacement_action_audit_to_system_logs');
  });

  it('corrige o ON CONFLICT incompatível com índice parcial', () => {
    const migration = repoFile('supabase/migrations/20260831143850_fix_force_completion_conflict_v8_4.sql');

    expect(migration).toContain('ON CONFLICT (client_event_id) DO NOTHING');
    expect(migration).toContain('ON CONFLICT DO NOTHING');
    expect(migration).toContain('replacement_force_conflict_safe');
    expect(migration).toContain('REPLACEMENT_V8_4_INCOMPLETE');
  });

  it('versiona o contrato v8.4 e bloqueia deploy incompatível', () => {
    const migration = 'supabase/migrations/20260831143850_fix_force_completion_conflict_v8_4.sql';
    const concurrentMarker = 'supabase/migrations/20260831142929_replacement_roles_flow_and_audit_v1.sql';
    const workflow = repoFile('.github/workflows/deploy.yml');

    expect(existsSync(resolve(process.cwd(), migration))).toBe(true);
    expect(existsSync(resolve(process.cwd(), concurrentMarker))).toBe(true);
    expect(repoFile(migration)).toContain('20260831_acprod_replacement_v8_4');
    expect(workflow).toContain('REQUIRED_MIGRATION_VERSION: "20260831143850"');
    expect(workflow).toContain('REQUIRED_RELEASE_VERSION: "20260831_acprod_replacement_v8_4"');
    expect(workflow).toContain('replacement_strict_role_hierarchy');
    expect(workflow).toContain('replacement_station_only_approval');
    expect(workflow).toContain('replacement_origin_classification');
    expect(workflow).toContain('replacement_force_adjustment_facts');
    expect(workflow).toContain('replacement_force_conflict_safe');
    expect(workflow).toContain('replacement_audit_mirror');
  });
});
