import { supabase } from '@/lib/supabaseClient';
import {
  normalizeTagValue,
  validateProductionStep as validateProductionStepRule,
} from '@/lib/traceabilityRules';
import { resolveProductionContext, productionContextToEntryFields } from '@/lib/productionLookupService';

export { normalizeTagValue } from '@/lib/traceabilityRules';

export const READER_TYPES = new Set([
  'keyboard_barcode',
  'camera_qrcode',
  'camera_barcode',
  'manual',
  'rfid_fixed',
  'rfid_handheld',
  'api',
]);

const EMPTY_RESULT = {
  success: false,
  status: 'invalid',
  message: '',
  lot: null,
  item: null,
  route: null,
  reading: null,
  nextStep: null,
  occurrence: null,
  kpiUpdate: null,
};

function standardResult(partial = {}) {
  return { ...EMPTY_RESULT, ...partial };
}

export function detectReaderType(payload = {}) {
  if (READER_TYPES.has(payload.readerType)) return payload.readerType;

  const rawValue = String(payload.rawValue || payload.tagValue || '').trim();
  const normalized = normalizeTagValue(rawValue);
  const mode = String(payload.mode || '').toLowerCase();
  const format = String(payload.detectedTagFormat || payload.format || '').toLowerCase();
  const tagType = payload.detectedTagType || normalized.tagType;

  if (mode === 'manual') return 'manual';
  if (mode === 'api') return 'api';
  if (mode === 'rfid' || tagType === 'rfid_epc') {
    return payload.handheld ? 'rfid_handheld' : 'rfid_fixed';
  }
  if (mode === 'camera' || format || payload.camera === true) {
    return tagType === 'qrcode' || format.includes('qr') ? 'camera_qrcode' : 'camera_barcode';
  }
  return 'keyboard_barcode';
}

function normalizePayload(payload, now = new Date()) {
  const normalized = normalizeTagValue(payload.rawValue ?? payload.tagValue);
  const readerType = detectReaderType({ ...payload, rawValue: normalized.tagValue });
  const cameraTagType = readerType === 'camera_qrcode'
    ? 'qrcode'
    : readerType === 'camera_barcode' ? 'barcode' : null;

  return {
    ...payload,
    rawValue: normalized.tagValue,
    detectedTagType: payload.detectedTagType || cameraTagType || normalized.tagType,
    detectedTagFormat: payload.detectedTagFormat || normalized.tagFormat,
    readerType,
    date: payload.date || now.toISOString().slice(0, 10),
    hour: payload.hour || now.toTimeString().slice(0, 5),
    quantity: Math.max(1, Number(payload.quantity) || 1),
  };
}

export function validateProductionStep(payload, ...legacyArgs) {
  if (legacyArgs.length) return validateProductionStepRule(payload, ...legacyArgs);
  return validateProductionStepRule(payload);
}

export function detectDuplicateReading(payload = {}) {
  const readings = payload.readings || payload.approvedReadings || [];
  const itemId = payload.itemId || payload.item?.id;
  const stepName = payload.stepName || payload.routeStep?.step_name || payload.item?.current_step;
  const tagValue = normalizeTagValue(payload.rawValue || payload.tagValue).tagValue;
  const readerType = detectReaderType(payload);
  const now = payload.now instanceof Date ? payload.now.getTime() : Number(payload.now) || Date.now();
  const debounceMs = Number(payload.debounceMs) || 2000;

  const approvedAtStep = readings.find((reading) => {
    const sameItem = !itemId || reading.item_id === itemId || reading.itemId === itemId;
    const sameStep = !stepName || reading.step_name === stepName || reading.stepName === stepName;
    return sameItem && sameStep && reading.status === 'approved';
  });
  if (approvedAtStep) {
    return { duplicate: true, status: 'duplicated', reason: 'step_already_approved', reading: approvedAtStep };
  }

  const recentSameTag = readings.find((reading) => {
    const value = normalizeTagValue(reading.tag_value || reading.tagValue || reading.rawValue).tagValue;
    const timestamp = new Date(reading.created_at || reading.createdAt || reading.readAt || 0).getTime();
    return value === tagValue && Number.isFinite(timestamp) && now - timestamp < debounceMs;
  });
  if (recentSameTag) {
    return {
      duplicate: true,
      status: 'duplicated',
      reason: readerType.startsWith('rfid_') ? 'rfid_debounce' : 'reader_debounce',
      reading: recentSameTag,
    };
  }

  return { duplicate: false, status: 'available', reason: null, reading: null };
}

export function buildProductionKpiUpdate(payload = {}) {
  const quantity = Math.max(1, Number(payload.quantity) || 1);
  const status = payload.status || (payload.success ? 'approved' : 'blocked');
  return {
    date: payload.date || new Date().toISOString().slice(0, 10),
    shift: payload.shift || null,
    cellName: payload.cellName || null,
    stepName: payload.stepName || payload.route?.step_name || null,
    total: quantity,
    approved: status === 'approved' ? quantity : 0,
    rejected: status === 'rejected' ? quantity : 0,
    blocked: ['blocked', 'duplicated', 'wrong_step', 'wrong_cell'].includes(status) ? 1 : 0,
  };
}

export function buildOccurrenceFromRejectedReading(payload = {}) {
  const item = payload.item || null;
  const lot = payload.lot || null;
  const reading = payload.reading || null;
  return {
    type: 'traceability_rejection',
    status: 'open',
    severity: payload.severity || 'high',
    reason: payload.reason || payload.message || 'Peça reprovada na coleta produtiva.',
    notes: payload.notes || payload.justification || '',
    lotId: lot?.id || payload.lotId || null,
    lotCode: lot?.lot_code || payload.lotCode || null,
    itemId: item?.id || payload.itemId || null,
    pieceCode: item?.piece_code || payload.pieceCode || null,
    readingId: reading?.id || payload.readingId || null,
    tagValue: reading?.tag_value || payload.tagValue || payload.rawValue || null,
    stepName: payload.stepName || reading?.step_name || item?.current_step || null,
    cellName: payload.cellName || reading?.cell_name || null,
    operator: payload.operator || reading?.operator || null,
    createdAt: payload.createdAt || new Date().toISOString(),
  };
}

function buildReading(clean, match, status, routeStep, now) {
  return {
    id: clean.readingId || `reading-${now.getTime()}`,
    tag_id: match.tag?.id || null,
    tag_value: clean.rawValue,
    tag_type: clean.detectedTagType,
    reader_type: clean.readerType,
    reader_id: clean.readerId || null,
    station_name: clean.stationName || null,
    cell_name: clean.cellName || null,
    operator: clean.operator || null,
    shift: clean.shift || null,
    date: clean.date,
    hour: clean.hour,
    item_id: match.item?.id || null,
    lot_id: match.lot?.id || null,
    step_name: routeStep?.step_name || clean.stepName || match.item?.current_step || null,
    quantity: clean.quantity,
    status,
    created_at: now.toISOString(),
  };
}

async function processWithRepository(clean, repository, now) {
  const match = await repository.findByTag(clean.rawValue);
  if (!match?.item) {
    return standardResult({ status: 'not_found', message: `Código ${clean.rawValue} não localizado.` });
  }

  const readings = await repository.getReadings(match.item.id);
  const route = match.route || [];
  const routeStep = route.find((step) => step.step_name === match.item.current_step) || route[0] || null;
  const duplicate = detectDuplicateReading({
    ...clean,
    item: match.item,
    stepName: routeStep?.step_name,
    readings,
    now,
  });

  if (duplicate.duplicate) {
    return standardResult({
      status: 'duplicated',
      message: duplicate.reason === 'rfid_debounce'
        ? 'EPC ignorado pelo intervalo de segurança da leitura RFID.'
        : 'Esta peça já foi baixada nesta etapa.',
      lot: match.lot,
      item: match.item,
      route: routeStep,
      reading: duplicate.reading,
      kpiUpdate: buildProductionKpiUpdate({ ...clean, status: 'duplicated', stepName: routeStep?.step_name }),
    });
  }

  const validation = validateProductionStep({
    item: match.item,
    route,
    cellName: clean.cellName,
    approvedReadings: readings,
    requestedStep: clean.stepName,
  });
  if (!validation.valid) {
    return standardResult({
      status: validation.status,
      message: validation.message,
      lot: match.lot,
      item: match.item,
      route: validation.expected || routeStep,
      kpiUpdate: buildProductionKpiUpdate({ ...clean, status: validation.status, stepName: routeStep?.step_name }),
    });
  }

  const reading = buildReading(clean, match, 'approved', validation.expected, now);
  await repository.saveReading(reading);

  const nextItem = {
    ...match.item,
    current_step: validation.next?.step_name || match.item.current_step,
    status: validation.next ? 'in_progress' : 'completed',
  };
  await repository.updateItem?.(nextItem);

  return standardResult({
    success: true,
    status: 'approved',
    message: validation.next
      ? `Leitura aprovada. Próxima etapa: ${validation.next.step_name}.`
      : 'Leitura aprovada. Rota produtiva concluída.',
    lot: match.lot,
    item: nextItem,
    route: validation.expected,
    reading,
    nextStep: validation.next,
    kpiUpdate: buildProductionKpiUpdate({ ...clean, status: 'approved', stepName: validation.expected?.step_name }),
  });
}

export async function processProductionReading(payload, dependencies = {}) {
  const now = dependencies.now instanceof Date ? dependencies.now : new Date();
  const clean = normalizePayload(payload || {}, now);
  if (!clean.rawValue) {
    return standardResult({ message: 'Informe uma identificação produtiva válida.' });
  }
  if (clean.readerType === 'manual' && clean.confirmed !== true && clean.manualConfirmed !== true) {
    return standardResult({ status: 'manual_confirmation_required', message: 'Confirme a identificação digitada antes da baixa manual.' });
  }
  if (clean.readerType === 'manual' && clean.requiresJustification && !String(clean.justification || '').trim()) {
    return standardResult({ status: 'manual_justification_required', message: 'Informe a justificativa da baixa manual.' });
  }

  if (dependencies.repository) {
    return processWithRepository(clean, dependencies.repository, now);
  }

  let productionContext = null;
  let contextWarning = '';
  try {
    const resolver = dependencies.resolveProductionContext || resolveProductionContext;
    productionContext = await resolver({ value: clean.rawValue, type: 'tag' });
    if (productionContext?.contextFound) {
      Object.assign(clean, {
        productionContext: productionContextToEntryFields(productionContext),
        productionOrderId: productionContext.productionOrder?.id || null,
        lotId: productionContext.lot?.id || null,
        orderItemId: productionContext.item?.id || null,
      });
    } else {
      contextWarning = productionContext?.warnings?.[0] || 'Contexto produtivo não localizado.';
    }
  } catch (error) {
    contextWarning = error.message || 'Falha ao resolver contexto produtivo.';
  }

  const { data, error } = await supabase.rpc('process_production_reading', { p_payload: clean });
  if (error) {
    const unavailable = error.code === 'PGRST202'
      || /could not find.+process_production_reading|schema cache/i.test(error.message || '');
    throw new Error(unavailable
      ? 'A estrutura de coleta ainda não foi aplicada no Supabase.'
      : `Falha ao processar leitura${error.code ? ` (${error.code})` : ''}: ${error.message}`);
  }
  return standardResult({
    ...(data || {}),
    productionContext,
    contextWarning,
  });
}

export async function registerTraceabilityRejection(payload) {
  const clean = normalizePayload(payload || {});
  const { data, error } = await supabase.rpc('register_traceability_rejection', { p_payload: clean });
  if (error) throw new Error(`Falha ao registrar reprovação: ${error.message}`);
  return standardResult(data || {});
}

export async function fetchRecentReadings(params = {}) {
  const limit = typeof params === 'number' ? params : (params.limit || 30);
  const cellName = typeof params === 'object' ? params.cellName : null;
  const date = typeof params === 'object' ? params.date : null;

  let query = supabase
    .from('production_stage_readings')
    .select('*');
    
  if (cellName) {
    query = query.eq('cell_name', cellName);
  }
  if (date) {
    query = query.eq('date', date);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function fetchCollectionKpis(params = {}) {
  const date = typeof params === 'string' ? params : (params.date || new Date().toISOString().slice(0, 10));
  const cellName = typeof params === 'object' ? params.cellName : null;
  const shift = typeof params === 'object' ? params.shift : null;
  const lotId = typeof params === 'object' ? params.lotId : null;
  const loadNumber = typeof params === 'object' ? params.loadNumber : null;
  const orderNumber = typeof params === 'object' ? params.orderNumber : null;

  if (lotId || loadNumber || orderNumber) {
    let query = supabase.from('production_cell_progress').select('*');
    if (lotId) query = query.eq('lot_id', lotId);
    if (loadNumber) query = query.eq('load_number', loadNumber);
    if (orderNumber) query = query.eq('order_number', orderNumber);
    if (cellName) query = query.eq('cell_name', cellName);
    
    const { data, error } = await query;
    if (error) throw error;
    
    const rows = data || [];
    const planned = rows.reduce((sum, row) => sum + (Number(row.planned_quantity) || 0), 0);
    const approved = rows.reduce((sum, row) => sum + (Number(row.approved_quantity) || 0), 0);
    const rejected = rows.reduce((sum, row) => sum + (Number(row.rejected_quantity) || 0), 0);
    const blocked = rows.reduce((sum, row) => sum + (Number(row.blocked_quantity) || 0), 0);
    const pending = rows.reduce((sum, row) => sum + (Number(row.pending_quantity) || 0), 0);
    
    return {
      total: planned,
      planned,
      approved,
      rejected,
      blocked,
      pending,
      progressPercent: planned > 0 ? Math.min(Math.round((approved / planned) * 100), 100) : 0
    };
  }

  let query = supabase
    .from('production_stage_readings')
    .select('status,event_type,quantity,step_name,cell_name,created_at')
    .eq('date', date);
    
  if (cellName) query = query.eq('cell_name', cellName);
  if (shift) query = query.eq('shift', shift);
  
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  const rows = data || [];
  
  const approved = rows.filter((row) => row.status === 'approved').reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  const rejected = rows.filter((row) => row.status === 'rejected').reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  const blocked = rows.filter((row) => ['blocked', 'duplicated'].includes(row.status)).reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  
  return {
    total: approved + rejected + blocked,
    approved,
    rejected,
    blocked,
    pending: 0
  };
}
