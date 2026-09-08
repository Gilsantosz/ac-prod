const metadataKeys = [
  'item', 'piece', 'lot', 'order', 'reading', 'route', 'general_lot',
  'piece_id', 'piece_uid', 'traceability_code', 'raw_value',
  'lot_id', 'lot_code', 'customer_lot_code', 'pcp_import_batch_id', 'general_lot_code',
  'customer_name', 'client_name', 'order_id', 'order_number',
  'cell_id', 'cell_name', 'machine_id', 'step_code', 'lot_progress_percent',
];

const missing = (value) => value == null || value === '';
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);

function fillMissing(previous, incoming) {
  if (missing(incoming)) return previous;
  if (missing(previous)) return incoming;
  if (Array.isArray(previous)) {
    return previous.length === 0 && Array.isArray(incoming) && incoming.length > 0
      ? incoming : previous;
  }
  if (!record(previous) || !record(incoming)) return previous;
  let merged = previous;
  for (const key of Object.keys(incoming)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    const value = fillMissing(previous[key], incoming[key]);
    if (value !== previous[key]) {
      if (merged === previous) merged = { ...previous };
      merged[key] = value;
    }
  }
  return merged;
}

/** Completa o recibo compacto da mesma decisão; nunca altera a decisão ou autoria. */
export function enrichCollectionResult(previous = {}, incoming = {}) {
  let merged = previous;
  for (const key of metadataKeys) {
    const value = fillMissing(previous?.[key], incoming?.[key]);
    if (value !== previous?.[key]) {
      if (merged === previous) merged = { ...previous };
      merged[key] = value;
    }
  }
  return merged;
}
