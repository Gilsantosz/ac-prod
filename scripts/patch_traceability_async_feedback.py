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
