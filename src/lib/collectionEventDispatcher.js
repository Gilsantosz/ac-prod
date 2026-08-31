import { processProductionReading } from '@/lib/traceabilityService';
import { processFastProductionReading } from '@/lib/fastProductionReadingService';
import { collectReplacementStageV2, REPLACEMENT_EVENT_KIND } from '@/lib/replacementService';

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

  if (eventKind === COLLECTION_EVENT_KINDS.REPLACEMENT_STAGE) {
    return collectReplacementStageV2({
      sessionToken: event.session_token,
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
