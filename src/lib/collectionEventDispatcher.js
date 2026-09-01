import { processProductionReading } from '@/lib/traceabilityService';
import { processFastProductionReading } from '@/lib/fastProductionReadingService';
import { processProductionCollectionBatch } from '@/lib/collectionBatchService';
import { collectReplacementStageV2, REPLACEMENT_EVENT_KIND } from '@/lib/replacementService';
import { getOperatorSession } from '@/lib/operatorSessionService';

export const COLLECTION_EVENT_KINDS = Object.freeze({
  PRODUCTION_STAGE: 'production_stage',
  REPLACEMENT_STAGE: REPLACEMENT_EVENT_KIND,
});

export function resolveCollectionEventKind(event = {}) {
  if (event.event_kind) return event.event_kind;
  return event.is_replacement_event
    ? COLLECTION_EVENT_KINDS.REPLACEMENT_STAGE
    : COLLECTION_EVENT_KINDS.PRODUCTION_STAGE;
}

export async function dispatchCollectionEvent(event) {
  const eventKind = resolveCollectionEventKind(event);
  const currentSession = getOperatorSession();

  if (eventKind === COLLECTION_EVENT_KINDS.REPLACEMENT_STAGE) {
    return collectReplacementStageV2({
      // Fallback V2: a credencial corrente é obtida somente na fronteira RPC.
      sessionToken: currentSession?.token || null,
      barcode: event.raw_value || event.rawValue,
      clientEventId: event.client_event_id,
      deviceId: event.device_id,
      createdAtClient: event.created_at_client,
      payload: {
        ...(event.payload || {}),
        queued_offline: event.queued_offline === true,
        event_kind: COLLECTION_EVENT_KINDS.REPLACEMENT_STAGE,
      },
    });
  }

  if (eventKind === COLLECTION_EVENT_KINDS.PRODUCTION_STAGE) {
    const productionPayload = {
      ...event,
      rawValue: event.raw_value || event.rawValue,
      cellName: event.cellName || event.cell_name,
      operator: event.operator || event.operator_name,
      operatorId: event.operatorId || event.operator_id,
      machineId: event.machineId || event.machine_id,
      machineName: event.machineName || event.machine_name,
      client_event_id: event.client_event_id,
      readerType: event.readerType || event.reader_type || 'keyboard_barcode',
      createdAtClient: event.createdAtClient || event.created_at_client,
      deviceId: event.deviceId || event.device_id,
      operatorSessionToken: currentSession?.token || null,
    };

    const useFastPath = event.fastPath === true
      || event.fast_path === true
      || event.exactDigitCapture === true
      || event.exact_digit_capture === true;

    return useFastPath
      ? processFastProductionReading(productionPayload)
      : processProductionReading(productionPayload);
  }

  const error = new Error(`Tipo de evento de coleta não suportado: ${eventKind}`);
  error.retryable = false;
  throw error;
}

function wrapIndividualResult(event, result) {
  return {
    client_event_id: event.client_event_id,
    status_sincronizacao: 'sincronizada',
    retryable: false,
    error: null,
    result,
  };
}

function wrapIndividualError(event, error) {
  return {
    client_event_id: event.client_event_id,
    status_sincronizacao: 'erro',
    retryable: error?.retryable !== false,
    error: error?.message || String(error),
    result: error?.result || {
      success: false,
      status: 'error',
      reason_code: error?.code || 'COLLECTION_EVENT_ERROR',
      message: error?.message || String(error),
      client_event_id: event.client_event_id,
    },
  };
}

/**
 * Despacha um micro-lote mantendo a ordem global da fila.
 *
 * Eventos produtivos consecutivos usam um único INSERT[] em coletas_producao.
 * Reposição continua no RPC próprio e nunca é misturada ao gatilho produtivo.
 */
export async function dispatchCollectionEventBatch(events = [], options = {}) {
  if (!Array.isArray(events) || events.length === 0) return [];

  const results = [];
  let productionBuffer = [];

  const flushProductionBuffer = async () => {
    if (!productionBuffer.length) return;
    const batchResults = await processProductionCollectionBatch(
      productionBuffer,
      options,
    );
    results.push(...batchResults);
    productionBuffer = [];
  };

  for (const event of events) {
    const eventKind = resolveCollectionEventKind(event);

    if (eventKind === COLLECTION_EVENT_KINDS.PRODUCTION_STAGE) {
      productionBuffer.push(event);
      continue;
    }

    await flushProductionBuffer();

    try {
      const result = await dispatchCollectionEvent(event);
      results.push(wrapIndividualResult(event, result));
    } catch (error) {
      results.push(wrapIndividualError(event, error));
    }
  }

  await flushProductionBuffer();
  return results;
}
