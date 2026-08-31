from pathlib import Path

traceability_path = Path('src/pages/TraceabilityCollection.jsx')
traceability = traceability_path.read_text(encoding='utf-8')

hook_block = """  const { stats: queueStats, flushing, enqueue, processNow, retryQueueErrors } = useCollectionQueue(processEvent, {\n    cellName,\n    machineId: machine?.id,\n    eventKind: COLLECTION_EVENT_KINDS.PRODUCTION_STAGE,\n  });\n"""

listener_block = """  const { stats: queueStats, flushing, enqueue, processNow, retryQueueErrors } = useCollectionQueue(processEvent, {\n    cellName,\n    machineId: machine?.id,\n    eventKind: COLLECTION_EVENT_KINDS.PRODUCTION_STAGE,\n  });\n\n  // A confirmação final chega depois do ACK do inbox, via Realtime/polling.\n  useEffect(() => {\n    const handleAsyncCollectionResult = (browserEvent) => {\n      const detail = browserEvent?.detail || {};\n      const result = detail.result;\n      if (!detail.final || !result || result.pending) return;\n\n      updateFeedback({\n        ...result,\n        client_event_id: detail.event?.client_event_id || result.client_event_id,\n      });\n\n      if (result.item || result.reading || result.lot || result.order) {\n        const uid = detail.event?.raw_value || detail.event?.rawValue || '';\n        setSelectedPiece({\n          id: result.item?.id || result.reading?.piece_id || null,\n          piece_uid: uid,\n          piece_name: result.item?.name || result.item?.piece_name || 'Peça Lida',\n          lot_id: result.lot?.id || null,\n          lot_code: result.lot?.lot_code || 'LOTE-N/A',\n          order_number: result.order?.order_number || result.order?.order_code || 'N/A',\n          client_name: result.order?.customer_name || 'Cliente não informado',\n          current_stage: result.route?.step_name || result.item?.current_stage || result.item?.current_step,\n          current_stage_name: result.route?.step_name || result.item?.current_stage || result.item?.current_step,\n          operator_name: operator,\n          status: result.status || 'approved',\n          route: [],\n          completedSteps: [],\n        });\n      }\n\n      refreshData();\n    };\n\n    window.addEventListener('collection-batch-result', handleAsyncCollectionResult);\n    return () => {\n      window.removeEventListener('collection-batch-result', handleAsyncCollectionResult);\n    };\n  }, [operator, refreshData, updateFeedback]);\n"""

if 'handleAsyncCollectionResult' not in traceability:
    if hook_block not in traceability:
        raise SystemExit('Bloco useCollectionQueue não localizado.')
    traceability = traceability.replace(hook_block, listener_block, 1)

ack_anchor = """        const result = await processNow(clientEventId);\n        updateFeedback({ ...result, client_event_id: clientEventId });\n        \n        if (result?.success) {\n"""
ack_replacement = """        const result = await processNow(clientEventId);\n        updateFeedback({ ...result, client_event_id: clientEventId });\n\n        // ACK local/inbox não é aprovação produtiva. A decisão final será\n        // entregue pelo monitor assíncrono sem bloquear a próxima leitura.\n        if (result?.pending || result?.accepted || result?.status === 'queued') {\n          return result;\n        }\n\n        if (result?.success) {\n"""

if 'ACK local/inbox não é aprovação produtiva' not in traceability:
    if ack_anchor not in traceability:
        raise SystemExit('Bloco de ACK da leitura não localizado.')
    traceability = traceability.replace(ack_anchor, ack_replacement, 1)

traceability_path.write_text(traceability, encoding='utf-8')

queue_path = Path('src/lib/collectionEventQueue.js')
queue = queue_path.read_text(encoding='utf-8')
race_anchor = """  const event = await dbGet(clientEventId);\n  if (!event) return;\n  const now = new Date().toISOString();\n  event.status = 'server_pending';\n"""
race_replacement = """  const event = await dbGet(clientEventId);\n  if (!event) return;\n  if (\n    event.status === 'synced'\n    || (event.status === 'error' && event.retryable === false)\n  ) return;\n  const now = new Date().toISOString();\n  event.status = 'server_pending';\n"""

if "event.status === 'synced'\n    || (event.status === 'error'" not in queue:
    if race_anchor not in queue:
        raise SystemExit('Bloco markEventServerPending não localizado.')
    queue = queue.replace(race_anchor, race_replacement, 1)

queue_path.write_text(queue, encoding='utf-8')

audit_path = Path('scripts/audit_collection_rollout.py')
audit = audit_path.read_text(encoding='utf-8')

ledger_anchor = """    "20260831143323", "20260831143850", "20260831150725",\n]\n"""
ledger_replacement = """    "20260831143323", "20260831143850", "20260831150725",\n    "20260831170836", "20260831221753", "20260831223614",\n]\n"""
if '"20260831223614"' not in audit:
    if ledger_anchor not in audit:
        raise SystemExit('Ledger da auditoria não localizado.')
    audit = audit.replace(ledger_anchor, ledger_replacement, 1)

async_anchor = """    replacement_v82_sql = read(migrations / "20260831135630_finalize_replacement_workflow_v8_2.sql")\n"""
async_block = """    async_sql = read(migrations / "20260831221753_collection_async_inbox_worker_v8_7.sql")\n    require_all(\n        async_sql,\n        (\n            "private.coleta_producao_credentials",\n            "FOR UPDATE SKIP LOCKED",\n            "process_collection_inbox_item",\n            "trg_wake_collection_inbox_worker",\n            "run-process-collection-inbox",\n            "ALTER PUBLICATION supabase_realtime",\n        ),\n        "inbox e worker assíncronos v8.7",\n    )\n    ingress_start = async_sql.find(\n        "CREATE OR REPLACE FUNCTION public.process_coleta_producao_ingress()"\n    )\n    ingress_end = async_sql.find(\n        "CREATE OR REPLACE FUNCTION public.claim_collection_inbox"\n    )\n    if ingress_start < 0 or ingress_end <= ingress_start:\n        fail("função leve de ingresso assíncrono não localizada")\n    if "process_production_reading_v2" in async_sql[ingress_start:ingress_end]:\n        fail("INSERT do inbox ainda executa a regra produtiva de forma síncrona")\n\n    async_release_sql = read(\n        migrations / "20260831223614_collection_async_release_probe_v8_7_1.sql"\n    )\n    require_all(\n        async_release_sql,\n        (\n            "get_public_collection_release()",\n            "collection_async_ingress_is_lightweight",\n            "collection_async_worker_rpcs",\n            "collection_async_session_lock_removed",\n            "collection_async_no_legacy_sync_dependency",\n            "20260831_acprod_collection_async_worker_v8_7_1",\n        ),\n        "marcador assíncrono v8.7.1",\n    )\n    if "get_public_collection_micro_batch_release()" in async_release_sql:\n        fail("marcador v8.7.1 ainda herda flags síncronas obsoletas")\n\n    replacement_v82_sql = read(migrations / "20260831135630_finalize_replacement_workflow_v8_2.sql")\n"""
if 'inbox e worker assíncronos v8.7' not in audit:
    if async_anchor not in audit:
        raise SystemExit('Ponto de inserção da auditoria SQL assíncrona não localizado.')
    audit = audit.replace(async_anchor, async_block, 1)

workflow_anchor = """            "get_public_collection_release",\n            "DATABASE_RELEASE_OK",\n            "needs: [database-release]",\n"""
workflow_replacement = """            "get_public_collection_release",\n            "DATABASE_RELEASE_OK",\n            'REQUIRED_ASYNC_COLLECTION_MIGRATION_VERSION: "20260831223614"',\n            'REQUIRED_ASYNC_COLLECTION_RELEASE_VERSION: "20260831_acprod_collection_async_worker_v8_7_1"',\n            "get_public_collection_async_release",\n            "ASYNC_COLLECTION_RELEASE_OK",\n            "collection_async_ingress_is_lightweight",\n            "collection_async_worker_rpcs",\n            "needs: [database-release]",\n"""
if 'ASYNC_COLLECTION_RELEASE_OK' not in audit:
    if workflow_anchor not in audit:
        raise SystemExit('Contrato do workflow não localizado na auditoria.')
    audit = audit.replace(workflow_anchor, workflow_replacement, 1)

queue_anchor = """            "refreshStatsSafely",\n            "fallbackLockRef",\n            "const id = await enqueueCollectionEvent(payload)",\n            "não bloqueia o próximo código",\n"""
queue_replacement = """            "refreshStatsSafely",\n            "fallbackLockRef",\n            "const id = await enqueueCollectionEvent(payload)",\n            "subscribeToCollectionInbox",\n            "reconcileServerPending",\n            "SERVER_POLL_INTERVAL_MS = 2_000",\n            "não bloqueia o próximo código",\n"""
if 'SERVER_POLL_INTERVAL_MS = 2_000' not in audit:
    if queue_anchor not in audit:
        raise SystemExit('Contrato da fila rápida não localizado na auditoria.')
    audit = audit.replace(queue_anchor, queue_replacement, 1)

realtime_anchor = """    realtime = read(repo / "src" / "hooks" / "useProductionRealtimeSync.js")\n"""
realtime_block = """    batch_service = read(repo / "src" / "lib" / "collectionBatchService.js")\n    require_all(\n        batch_service,\n        (\n            "server_accepted",\n            "fetchProductionCollectionResults",\n            ".insert(rows)",\n        ),\n        "ACK durável do inbox",\n    )\n\n    inbox_monitor = read(repo / "src" / "lib" / "collectionInboxMonitor.js")\n    require_all(\n        inbox_monitor,\n        ("postgres_changes", "coletas_producao", "normalizeCollectionIngressRow"),\n        "monitor Realtime do inbox",\n    )\n\n    queue_panel = read(repo / "src" / "components" / "entry" / "CollectionQueuePanel.jsx")\n    require_all(\n        queue_panel,\n        ("Aguardando envio", "Enviando ao servidor", "No servidor", "Processadas"),\n        "painel de estados assíncronos",\n    )\n\n    worker = read(repo / "supabase" / "functions" / "process-collection-inbox" / "index.ts")\n    require_all(\n        worker,\n        (\n            "claim_collection_inbox",\n            "process_collection_inbox_item",\n            "mapWithConcurrency",\n            "x-cron-secret",\n        ),\n        "Edge Function de processamento do inbox",\n    )\n\n    realtime = read(repo / "src" / "hooks" / "useProductionRealtimeSync.js")\n"""
if 'ACK durável do inbox' not in audit:
    if realtime_anchor not in audit:
        raise SystemExit('Ponto de inserção dos contratos do inbox não localizado.')
    audit = audit.replace(realtime_anchor, realtime_block, 1)

print_anchor = """    print("database_gate=collection_fast8_v8_5_fail_closed")\n"""
print_replacement = """    print("database_gate=collection_async_worker_v8_7_1_fail_closed")\n    print("collection_transport=indexeddb_to_durable_server_inbox")\n    print("collection_processing=edge_worker_skip_locked_independent_transactions")\n"""
if 'collection_async_worker_v8_7_1_fail_closed' not in audit:
    if print_anchor not in audit:
        raise SystemExit('Resumo da auditoria não localizado.')
    audit = audit.replace(print_anchor, print_replacement, 1)

rpc_print_anchor = """    print("collection_rpc=single_round_trip_fast_path")\n"""
rpc_print_replacement = """    print("collection_rpc=async_ack_then_final_decision")\n"""
if rpc_print_anchor in audit:
    audit = audit.replace(rpc_print_anchor, rpc_print_replacement, 1)

audit_path.write_text(audit, encoding='utf-8')
