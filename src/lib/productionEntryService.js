import { base44 } from './localDb';
import { buildProductionMetric } from './productionUnitRules';

/**
 * Normaliza e valida um apontamento manual de produção antes de salvar.
 * 
 * @param {Object} payload - Os dados vindos do formulário.
 * @param {Object} context - Dados de contexto (user, existingEntries, online, permissions, currentDateTime).
 * @returns {Object} Um resultado contendo success, payload normalizado, alertas, e sugestões de ocorrência.
 */
export function processManualProductionEntry(payload, context = {}) {
  const user = context.user || {};
  const existingEntries = context.existingEntries || [];
  const permissions = context.permissions || user.permissions || {};
  const currentDateTime = context.currentDateTime ? new Date(context.currentDateTime) : new Date();

  // 1. Normalização de dados
  const cell = payload.cell ? String(payload.cell).trim() : '';
  const date = payload.date ? String(payload.date).trim() : '';
  const shift = payload.shift ? String(payload.shift).trim() : '';
  const hour = payload.hour ? String(payload.hour).trim() : '';
  
  const produced = Math.max(0, Number(payload.produced) || 0);
  const scrap = Math.max(0, Number(payload.scrap) || 0);
  const downtime = Math.max(0, Number(payload.downtime) || 0);
  const target = Math.max(0, Number(payload.target) || 0);
  const hours = Math.max(1, Number(payload.hours) || 1);
  const operator = payload.operator ? String(payload.operator).trim() : (user.name || user.email || 'Operador Manual');

  const lot_code = payload.lot_code ? String(payload.lot_code).trim() : 'SEM_LOTE';
  const order_number = payload.order_number ? String(payload.order_number).trim() : 'MANUAL';
  const process_step = payload.process_step ? String(payload.process_step).trim() : (cell || 'APONTAMENTO_MANUAL');
  const product_code = payload.product_code ? String(payload.product_code).trim() : '';
  const product_name = payload.product_name ? String(payload.product_name).trim() : 'Não informado';
  const customer_name = payload.customer_name ? String(payload.customer_name).trim() : 'Não informado';
  const station_name = payload.station_name ? String(payload.station_name).trim() : '';
  const traceability_status = payload.traceability_status || (payload.production_order_id || payload.lot_id || payload.order_item_id ? 'resolved' : 'limited');

  const entry_mode = payload.entry_mode || 'manual';
  const source = payload.source || 'manual_entry';
  const approval_status = payload.approval_status || 'valid';
  const occurrence_id = payload.occurrence_id || null;
  const correction_of = payload.correction_of || null;

  // 2. Validações obrigatórias
  if (Number(payload.produced) < 0) {
    return { success: false, status: 'error', message: 'A quantidade produzida não pode ser negativa.' };
  }
  if (Number(payload.scrap) < 0) {
    return { success: false, status: 'error', message: 'A quantidade de refugo não pode ser negativa.' };
  }
  if (Number(payload.downtime) < 0) {
    return { success: false, status: 'error', message: 'O tempo de parada não pode ser negativo.' };
  }
  if (!cell) {
    return { success: false, status: 'error', message: 'A célula de produção é obrigatória.' };
  }
  if (!shift) {
    return { success: false, status: 'error', message: 'O turno de produção é obrigatório.' };
  }
  if (!hour) {
    return { success: false, status: 'error', message: 'A hora do apontamento é obrigatória.' };
  }
  if (!date) {
    return { success: false, status: 'error', message: 'A data do apontamento é obrigatória.' };
  }

  // Validar data futura
  const todayStr = currentDateTime.toISOString().split('T')[0];
  if (date > todayStr) {
    return { success: false, status: 'error', message: 'Lançamentos em datas futuras não são permitidos.' };
  }

  // 3. Detecção de duplicidade
  // "Se já existir lançamento para mesma data, turno, célula, hora, lote, OP e etapa, abrir diálogo de duplicidade."
  const duplicate = existingEntries.find(entry => {
    // Ignora registros cancelados ou estornados para duplicidade
    if (entry.approval_status && entry.approval_status !== 'valid') return false;

    const matchDate = entry.date === date;
    const matchShift = entry.shift === shift;
    const matchCell = entry.cell === cell;
    const matchHour = entry.hour === hour;
    const matchLot = (entry.lot_code || 'SEM_LOTE') === lot_code;
    const matchOrder = (entry.order_number || 'MANUAL') === order_number;
    const matchStep = (entry.process_step || entry.cell || 'APONTAMENTO_MANUAL') === process_step;
    const matchMode = (entry.entry_mode || 'manual') === entry_mode;

    return matchDate && matchShift && matchCell && matchHour && matchLot && matchOrder && matchStep && matchMode;
  });

  if (duplicate && !payload._skipDuplicateCheck) {
    return {
      success: false,
      status: 'duplicate',
      message: 'Já existe um lançamento registrado para este horário com o mesmo lote, OP e etapa.',
      duplicateEntry: duplicate
    };
  }

  // 4. Calcular eficiência
  const efficiency = target > 0 ? Math.round((produced / target) * 100) : 100;
  const metric = buildProductionMetric({
    ...payload,
    cell,
    process_step,
    operation_name: payload.operation_name || process_step,
    produced,
    quantity: produced,
    target,
    planned_target: payload.planned_target ?? target,
    planned_capacity: payload.planned_capacity ?? payload.capacity,
  });

  // 5. Preparar alertas
  const alerts = [];
  if (traceability_status === 'limited' || lot_code === 'SEM_LOTE' || order_number === 'MANUAL') {
    alerts.push('Apontamento sem lote/OP. Registro válido, porém com rastreabilidade limitada.');
  }

  const normalizedPayload = {
    date,
    shift,
    cell,
    hour,
    produced,
    target,
    scrap,
    downtime,
    operator,
    notes: payload.notes || '',
    order_number,
    lot_code,
    product_code,
    product_name,
    customer_name,
    process_step,
    station_name,
    production_order_id: payload.production_order_id || payload.order_id || null,
    order_id: payload.order_id || payload.production_order_id || null,
    lot_id: payload.lot_id || null,
    order_item_id: payload.order_item_id || null,
    system_order_number: payload.system_order_number || '',
    customer_order_number: payload.customer_order_number || '',
    load_number: payload.load_number || '',
    customer_code: payload.customer_code || '',
    customer_legal_name: payload.customer_legal_name || '',
    customer_trade_name: payload.customer_trade_name || '',
    cnpj: payload.cnpj || '',
    product_description: payload.product_description || '',
    route_code: payload.route_code || '',
    route_name: payload.route_name || '',
    finalization_date: payload.finalization_date || null,
    city: payload.city || '',
    state: payload.state || '',
    delivery_region: payload.delivery_region || '',
    mirror_quantity: Math.max(0, Number(payload.mirror_quantity) || 0),
    pallet_number: payload.pallet_number || '',
    traceability_status,
    entry_mode,
    source,
    approval_status,
    occurrence_id,
    correction_of,
    hours,
    ...metric,
  };

  // 6. Preparar ocorrência automática quando necessário
  const suggestedOccurrences = [];
  if (scrap > 0) {
    suggestedOccurrences.push({
      type: 'quality',
      date,
      shift,
      cell,
      operator,
      reason: payload._occurrenceReason || 'Qualidade / Refugo',
      downtime: 0,
      notes: `Refugo de qualidade gerado no apontamento da hora ${hour}. Lote: ${lot_code} | OP: ${order_number}.`,
      quantity: scrap
    });
  }

  if (downtime > 0) {
    suggestedOccurrences.push({
      type: 'downtime',
      date,
      shift,
      cell,
      operator,
      reason: payload._occurrenceReason || 'Outros',
      downtime,
      notes: `Parada registrada no apontamento da hora ${hour}. Lote: ${lot_code} | OP: ${order_number}.`,
      quantity: 0
    });
  }

  // Eficiência < 70% sugere ocorrência de baixa produtividade
  const isLowEfficiency = target > 0 && efficiency < 70;
  let efficiencyWarning = false;
  if (isLowEfficiency) {
    efficiencyWarning = true;
    if (!payload._efficiencyJustification && !payload._occurrenceReason) {
      suggestedOccurrences.push({
        type: 'low_efficiency',
        date,
        shift,
        cell,
        operator,
        reason: 'Baixa Produtividade',
        downtime: 0,
        notes: `Baixa eficiência (${efficiency}%) na hora ${hour}. Lote: ${lot_code} | OP: ${order_number}.`,
        quantity: 0
      });
    }
  }

  // Confirmações necessárias
  const requiresConfirmations = [];
  if (target > 0 && produced > target * 1.5) {
    requiresConfirmations.push('A quantidade produzida está muito acima da meta cadastrada. Deseja prosseguir?');
  }
  if (scrap > produced && produced > 0) {
    requiresConfirmations.push('A quantidade de refugo é maior que a quantidade produzida na hora. Confirma essa informação?');
  }

  // 7. Evento produtivo de rastreabilidade (caso aplicável)
  const traceabilityEvent = {
    event_type: 'manual_entry',
    reader_type: 'manual',
    source: 'manual_entry',
    quantity: produced,
    lot_code,
    order_number,
    product_code,
    product_name,
    process_step,
    cell,
    operator,
    date,
    shift,
    hour
  };

  // 8. Log de auditoria
  const auditLog = {
    action: correction_of ? 'correct_manual_entry' : 'create_manual_entry',
    entity: 'production_entry',
    details: {
      lot_code,
      order_number,
      produced,
      scrap,
      downtime,
      efficiency,
      operator
    }
  };

  return {
    success: true,
    status: 'success',
    message: 'Apontamento processado com sucesso.',
    payload: normalizedPayload,
    efficiency,
    alerts,
    suggestedOccurrences,
    requiresConfirmations,
    traceabilityEvent,
    auditLog,
    efficiencyWarning
  };
}
