#!/usr/bin/env python3
"""Fail-closed static audit for the AC.Prod2 collection and replacement rollout."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REQUIRED_LEDGER = [
    "20260831041525", "20260831041630", "20260831041816", "20260831042218",
    "20260831042800", "20260831042844", "20260831042917", "20260831043042",
    "20260831043203", "20260831043317", "20260831043350", "20260831043450",
    "20260831043640", "20260831043708", "20260831044147", "20260831044348",
    "20260831044443", "20260831044738", "20260831044828", "20260831044939",
    "20260831045000", "20260831045123", "20260831045242", "20260831045514",
    "20260831050652", "20260831051513", "20260831052152", "20260831052721",
    "20260831052809", "20260831134504", "20260831134819", "20260831134912",
    "20260831134944", "20260831135344", "20260831135630",
]
UNSAFE = {
    "20260831100000_concurrency_batch_lifecycle_operator_shifts.sql",
    "20260831120000_fix_collection_lifecycle_realtime_shifts_v2.sql",
}


def fail(message: str) -> None:
    print(f"AUDIT_FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def read(path: Path) -> str:
    if not path.exists():
        fail(f"arquivo ausente: {path}")
    return path.read_text(encoding="utf-8")


def require_all(content: str, markers: tuple[str, ...], label: str) -> None:
    for marker in markers:
        if marker not in content:
            fail(f"{label} sem requisito: {marker}")


def require_none(content: str, markers: tuple[str, ...], label: str) -> None:
    lowered = content.lower()
    for marker in markers:
        if marker.lower() in lowered:
            fail(f"{label} contém marcador proibido: {marker}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path("."))
    repo = parser.parse_args().repo.resolve()
    migrations = repo / "supabase" / "migrations"
    migration_names = {path.name for path in migrations.glob("*.sql")}

    for version in REQUIRED_LEDGER:
        matches = [name for name in migration_names if name.startswith(f"{version}_")]
        if len(matches) != 1:
            fail(f"ledger local exige exatamente uma migração {version}; encontrado={matches}")

    present_unsafe = sorted(UNSAFE & migration_names)
    if present_unsafe:
        fail(f"migrações substituídas ainda ativas: {present_unsafe}")

    history_sql = read(migrations / "20260831052152_stage_reading_history_compatibility_v6.sql")
    require_all(
        history_sql,
        (
            "ADD COLUMN IF NOT EXISTS raw_value",
            "GENERATED ALWAYS AS (tag_value) STORED",
            "ADD COLUMN IF NOT EXISTS traceability_code",
            "idx_stage_readings_traceability_code_compat",
        ),
        "compatibilidade do Histórico",
    )

    collection_sql = read(migrations / "20260831052721_finalize_collection_rollout_v6.sql")
    require_all(
        collection_sql,
        (
            "process_production_reading_v2(jsonb)",
            "resolve_operator_shift_window(uuid,timestamptz)",
            "recalculate_cell_lot_state(uuid,text,text,uuid,uuid)",
            "refresh_collection_lot_state(uuid,uuid)",
            "production_cell_lot_states",
            "production_cell_active_contexts",
            "ACPROD_COLLECTION_V6_DUPLICATES",
            "ACPROD_COLLECTION_V6_LOT_DRIFT",
        ),
        "contrato SQL da coleta",
    )

    replacement_sql = read(migrations / "20260831135630_finalize_replacement_workflow_v8_2.sql")
    require_all(
        replacement_sql,
        (
            "finalize_replacement_workflow_v8_2",
            "20260831_acprod_replacement_v8_2",
            "quality_manager",
            "force_complete_replacements",
            "can_approve_replacements()",
            "can_force_complete_replacements()",
            "get_replacement_station_queue_v3(text,text)",
            "approval_entry_count = 0",
            "approved_cells = '[]'::jsonb",
            "REPLACEMENT_V8_2_INCOMPLETE",
            "replacement_station_only_approval",
            "replacement_force_justification_only",
        ),
        "contrato SQL da reposição",
    )

    combined_sql = "\n".join(read(path) for path in migrations.glob("20260831*.sql"))
    for marker in ("TRUNCATE ", "DROP TABLE ", "DELETE FROM public.production_"):
        if marker.upper() in combined_sql.upper():
            fail(f"operação destrutiva proibida encontrada: {marker}")

    workflow = read(repo / ".github" / "workflows" / "deploy.yml")
    require_all(
        workflow,
        (
            "pull_request:",
            'REQUIRED_MIGRATION_VERSION: "20260831135630"',
            'REQUIRED_RELEASE_VERSION: "20260831_acprod_replacement_v8_2"',
            "replacement_quality_role",
            "replacement_decision_rbac",
            "replacement_station_only_approval",
            "replacement_force_justification_only",
            "replacement_station_queue",
            "replacement_canonical_lot_close",
            "get_public_collection_release",
            "DATABASE_RELEASE_OK",
            "needs: [database-release]",
            "actions/checkout@v6",
            "actions/setup-node@v6",
            "actions/upload-pages-artifact@v5",
            "actions/deploy-pages@v5",
        ),
        "workflow",
    )
    for unsafe_marker in ("Pulando migracao", "Skipping database migrations"):
        if unsafe_marker in workflow:
            fail(f"workflow permite falso positivo: {unsafe_marker}")

    collection_service = read(repo / "src" / "lib" / "collectionService.js")
    require_all(
        collection_service,
        ("get_collection_dashboard_snapshot_v2", "get_operator_shift_kpis_v2"),
        "serviço de coleta",
    )

    traceability_page = read(repo / "src" / "pages" / "TraceabilityCollection.jsx")
    if "modalOpen={isAnyModalOpen}" not in traceability_page:
        fail("página não suspende scanner durante modais")

    collection_item = read(repo / "src" / "components" / "collection" / "CollectionReadItem.jsx")
    action_start = collection_item.find("{/* Ações rápidas no card */}")
    if action_start < 0:
        fail("bloco de ações do Histórico não localizado")
    action_block = collection_item[action_start:]
    if action_block.count("<Button") < 3 or action_block.count('type="button"') < 3:
        fail("Ocorrência/Reprovar/Histórico não estão protegidos com type=button")

    scanner = read(repo / "src" / "components" / "traceability" / "TraceabilityScannerPanel.jsx")
    require_all(scanner, ("modalOpen = false", "isSuspended", "hasOpenDialog"), "proteção de foco do scanner")

    realtime = read(repo / "src" / "hooks" / "useProductionRealtimeSync.js")
    require_all(realtime, ("production_cell_lot_states", "production_cell_active_contexts"), "mapa Realtime")

    approval_modal = read(repo / "src" / "components" / "replacement" / "ReplacementApproveModal.jsx")
    require_all(
        approval_modal,
        ("approveReplacement(orderId)", "A aprovação é uma autorização de produção", "return null"),
        "aprovação direta da reposição",
    )
    require_none(
        approval_modal,
        ("<Dialog", "selected_cells", "selectedCells", 'type="password"', "Justificativa"),
        "aprovação direta da reposição",
    )

    approval_service = read(repo / "src" / "lib" / "replacementApprovalService.js")
    require_all(
        approval_service,
        (
            "automaticEntriesSupported: false",
            "approvalMode: 'station_queue'",
            "automatic_entries || 0",
            "baixa automática indevida",
        ),
        "serviço de aprovação da reposição",
    )
    require_none(approval_service, ("selected_cells:", "notes: notes.trim()"), "serviço de aprovação da reposição")

    force_modal = read(repo / "src" / "components" / "replacement" / "ReplacementForceCompleteModal.jsx")
    require_all(
        force_modal,
        ("Justificativa obrigatória", "Nenhuma senha adicional é solicitada", "reason.trim()"),
        "conclusão forçada",
    )
    require_none(force_modal, ('type="password"', "adminPassword", "Senha do Administrador"), "conclusão forçada")

    replacement_card = read(repo / "src" / "components" / "replacement" / "ReplacementOrderCard.jsx")
    require_all(
        replacement_card,
        ("force_complete_replacements", "Aprovar Reposição", "Concluir Forçada"),
        "cartão de reposição",
    )

    station = read(repo / "src" / "pages" / "ReplacementStationPage.jsx")
    require_all(
        station,
        (
            'data-testid="replacement-station-technical-specs"',
            "Dimensões da peça",
            "Material / cor",
            "Espessura",
            "Peça substituta para produzir",
            "Somente peças disponíveis nesta célula podem receber baixa",
        ),
        "posto de reposição",
    )

    roles = read(repo / "src" / "lib" / "roleProfiles.js")
    require_all(
        roles,
        (
            "quality_manager",
            "force_complete_replacements: true",
            "['quality_manager', 'supervisor', 'manager', 'admin']",
        ),
        "hierarquia de papéis",
    )

    edge = read(repo / "supabase" / "functions" / "admin-users" / "index.ts")
    require_all(
        edge,
        (
            "'quality_manager'",
            "quality_manager: 25",
            "if (role === 'quality') return 'quality_manager'",
        ),
        "Edge Function de usuários",
    )

    print("AUDIT_ACPROD_ROLLOUT_OK")
    print(f"ledger_versions={len(REQUIRED_LEDGER)}")
    print("database_gate=replacement_v8_2_fail_closed")
    print("history_modal=protected")
    print("replacement_approval=station_queue_only")
    print("replacement_force_completion=justification_only")
    print("replacement_station_ux=technical_specs_highlighted")
    print("replacement_roles=quality_supervisor_manager_admin")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
