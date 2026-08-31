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
    "20260831134944", "20260831135344", "20260831135630", "20260831142929",
    "20260831143323", "20260831143850", "20260831150725",
    "20260831170836", "20260831221753", "20260831223614",
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

    fast8_sql = read(migrations / "20260831150725_collection_exact_8_digit_fast_capture_v8_5.sql")
    require_all(
        fast8_sql,
        (
            "collection_exact_8_digit_fast_capture_v8_5",
            "20260831_acprod_collection_fast8_v8_5",
            "normalize_collection_scan_code",
            "^[0-9]{8}$",
            "INVALID_CODE_LENGTH",
            "expected_code_length",
            "collection_exact_8_digit_scan",
            "collection_active_tags_8_digits",
            "keyboard_barcode",
            "camera_qrcode",
            "camera_barcode",
            "manual",
        ),
        "contrato SQL da coleta rápida de 8 dígitos",
    )

    async_sql = read(migrations / "20260831221753_collection_async_inbox_worker_v8_7.sql")
    require_all(
        async_sql,
        (
            "private.coleta_producao_credentials",
            "FOR UPDATE SKIP LOCKED",
            "process_collection_inbox_item",
            "trg_wake_collection_inbox_worker",
            "run-process-collection-inbox",
            "ALTER PUBLICATION supabase_realtime",
        ),
        "inbox e worker assíncronos v8.7",
    )
    ingress_start = async_sql.find(
        "CREATE OR REPLACE FUNCTION public.process_coleta_producao_ingress()"
    )
    ingress_end = async_sql.find(
        "CREATE OR REPLACE FUNCTION public.claim_collection_inbox"
    )
    if ingress_start < 0 or ingress_end <= ingress_start:
        fail("função leve de ingresso assíncrono não localizada")
    if "process_production_reading_v2" in async_sql[ingress_start:ingress_end]:
        fail("INSERT do inbox ainda executa a regra produtiva de forma síncrona")

    async_release_sql = read(
        migrations / "20260831223614_collection_async_release_probe_v8_7_1.sql"
    )
    require_all(
        async_release_sql,
        (
            "get_public_collection_release()",
            "collection_async_ingress_is_lightweight",
            "collection_async_worker_rpcs",
            "collection_async_session_lock_removed",
            "collection_async_no_legacy_sync_dependency",
            "20260831_acprod_collection_async_worker_v8_7_1",
        ),
        "marcador assíncrono v8.7.1",
    )
    if "get_public_collection_micro_batch_release()" in async_release_sql:
        fail("marcador v8.7.1 ainda herda flags síncronas obsoletas")

    replacement_v82_sql = read(migrations / "20260831135630_finalize_replacement_workflow_v8_2.sql")
    require_all(
        replacement_v82_sql,
        (
            "20260831_acprod_replacement_v8_2",
            "quality_manager",
            "can_approve_replacements()",
            "can_force_complete_replacements()",
            "approval_entry_count = 0",
            "replacement_station_only_approval",
        ),
        "baseline SQL da reposição v8.2",
    )

    replacement_v83_sql = read(migrations / "20260831143323_reconcile_replacement_workflow_v8_3.sql")
    require_all(
        replacement_v83_sql,
        (
            "reconcile_replacement_workflow_v8_3",
            "current_profile_can_decide_replacement",
            "replacement_origin_classification",
            "replacement_audit_mirror",
            "manual_adjustment",
            "conclusao_forcada_reposicao",
        ),
        "reconciliação SQL da reposição v8.3",
    )

    replacement_v84_sql = read(migrations / "20260831143850_fix_force_completion_conflict_v8_4.sql")
    require_all(
        replacement_v84_sql,
        (
            "fix_force_completion_conflict_v8_4",
            "ON CONFLICT DO NOTHING",
            "replacement_force_conflict_safe",
        ),
        "correção do conflito parcial v8.4",
    )

    concurrent_marker = read(migrations / "20260831142929_replacement_roles_flow_and_audit_v1.sql")
    require_all(
        concurrent_marker,
        ("migration-ledger alignment", "v8.3", "SELECT 1"),
        "marcador da migração concorrente",
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
            'REQUIRED_MIGRATION_VERSION: "20260831150725"',
            'REQUIRED_RELEASE_VERSION: "20260831_acprod_collection_fast8_v8_5"',
            "collection_exact_8_digit_scan",
            "collection_active_tags_8_digits",
            "replacement_quality_role",
            "replacement_decision_rbac",
            "replacement_strict_role_hierarchy",
            "replacement_station_only_approval",
            "replacement_force_conflict_safe",
            "get_public_collection_release",
            "DATABASE_RELEASE_OK",
            'REQUIRED_ASYNC_COLLECTION_MIGRATION_VERSION: "20260831223614"',
            'REQUIRED_ASYNC_COLLECTION_RELEASE_VERSION: "20260831_acprod_collection_async_worker_v8_7_1"',
            "get_public_collection_async_release",
            "ASYNC_COLLECTION_RELEASE_OK",
            "collection_async_ingress_is_lightweight",
            "collection_async_worker_rpcs",
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
    require_all(
        scanner,
        (
            "modalOpen = false",
            "isSuspended",
            "hasOpenDialog",
            "DUPLICATE_TRIGGER_GUARD_MS",
            "parseProductionScanCode",
            "if (mode === 'scanner' && parsed.valid)",
            "setValue('')",
            "Promise.resolve(onRead",
            "fastPath: true",
            "exactDigitCapture: true",
            "expectedCodeLength: PRODUCTION_SCAN_LENGTH",
        ),
        "captura imediata do scanner",
    )
    require_none(
        scanner,
        ("autoSubmitTimer", "value.trim().length < 3", "setTimeout(() => submitInput(), 160)"),
        "captura imediata do scanner",
    )

    tag_input = read(repo / "src" / "components" / "traceability" / "ProductionTagInput.jsx")
    require_all(
        tag_input,
        (
            'inputMode="numeric"',
            "09950001",
            "disparada automaticamente",
            "digitCount}/{PRODUCTION_SCAN_LENGTH}",
        ),
        "entrada visual de 8 dígitos",
    )

    scan_rules = read(repo / "src" / "lib" / "productionScanCode.js")
    require_all(
        scan_rules,
        (
            "PRODUCTION_SCAN_LENGTH = 8",
            "PRODUCTION_SCAN_PATTERN = /^\\d{8}$/",
            "overflow",
            "hasUnsupportedCharacters",
            "preservando zeros à esquerda",
        ),
        "regra de código produtivo",
    )

    fast_service = read(repo / "src" / "lib" / "fastProductionReadingService.js")
    require_all(
        fast_service,
        (
            "processFastProductionReading",
            "normalizeProductionScanCode",
            "supabase.rpc('process_production_reading'",
            "fastPath: true",
            "expectedCodeLength: PRODUCTION_SCAN_LENGTH",
        ),
        "serviço rápido de coleta",
    )
    require_none(
        fast_service,
        ("resolveProductionContext", "productionContextToEntryFields"),
        "serviço rápido de coleta",
    )

    dispatcher = read(repo / "src" / "lib" / "collectionEventDispatcher.js")
    require_all(
        dispatcher,
        (
            "processFastProductionReading",
            "event.fastPath === true",
            "event.exactDigitCapture === true",
        ),
        "roteamento do caminho rápido",
    )

    queue_hook = read(repo / "src" / "hooks" / "useCollectionQueue.js")
    require_all(
        queue_hook,
        (
            "refreshStatsSafely",
            "fallbackLockRef",
            "const id = await enqueueCollectionEvent(payload)",
            "subscribeToCollectionInbox",
            "reconcileServerPending",
            "SERVER_POLL_INTERVAL_MS = 2_000",
            "não bloqueia o próximo código",
        ),
        "fila rápida e FIFO",
    )

    batch_service = read(repo / "src" / "lib" / "collectionBatchService.js")
    require_all(
        batch_service,
        (
            "server_accepted",
            "fetchProductionCollectionResults",
            ".insert(rows)",
        ),
        "ACK durável do inbox",
    )

    inbox_monitor = read(repo / "src" / "lib" / "collectionInboxMonitor.js")
    require_all(
        inbox_monitor,
        ("postgres_changes", "coletas_producao", "normalizeCollectionIngressRow"),
        "monitor Realtime do inbox",
    )

    queue_panel = read(repo / "src" / "components" / "entry" / "CollectionQueuePanel.jsx")
    require_all(
        queue_panel,
        ("Aguardando envio", "Enviando ao servidor", "No servidor", "Processadas"),
        "painel de estados assíncronos",
    )

    worker = read(repo / "supabase" / "functions" / "process-collection-inbox" / "index.ts")
    require_all(
        worker,
        (
            "claim_collection_inbox",
            "process_collection_inbox_item",
            "mapWithConcurrency",
            "x-cron-secret",
        ),
        "Edge Function de processamento do inbox",
    )

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
        ("'quality_manager'", "quality_manager: 25", "canonicalManagedCells"),
        "Edge Function de usuários",
    )

    print("AUDIT_ACPROD_ROLLOUT_OK")
    print(f"ledger_versions={len(REQUIRED_LEDGER)}")
    print("database_gate=collection_async_worker_v8_7_1_fail_closed")
    print("collection_transport=indexeddb_to_durable_server_inbox")
    print("collection_processing=edge_worker_skip_locked_independent_transactions")
    print("scanner_trigger=immediate_on_eighth_digit")
    print("scanner_input=exactly_8_numeric_digits")
    print("scanner_throughput=non_blocking_capture_fifo_sync")
    print("collection_rpc=async_ack_then_final_decision")
    print("history_modal=protected")
    print("replacement_flow=v8_4_preserved")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
