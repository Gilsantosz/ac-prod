/**
 * AC.Prod MES — Serviço de Etiquetas Térmicas de Reposição e Validações Promob
 */

import { supabase } from '@/lib/supabaseClient';
import { auditLog, AUDIT_ACTIONS } from '@/lib/auditLog';

/**
 * Gera o código de rastreio exclusivo da peça de reposição no formato:
 * [código original]-REP-R[sequência]
 * Exemplo: 09950020-REP-R01
 */
export function buildReplacementTraceCode(originalPiece, sequence = 1) {
  const origCode = (
    originalPiece?.promob_barcode ||
    originalPiece?.promob_original_code ||
    originalPiece?.piece_code ||
    originalPiece?.traceability_code ||
    '00000000'
  ).trim();

  const seqStr = String(sequence).padStart(2, '0');
  return `${origCode}-REP-R${seqStr}`;
}

/**
 * Executa as validações obrigatórias para liberação de impressão da etiqueta de reposição.
 */
export function validateReplacementLabelData(order, originalPiece = null, replacementPiece = null) {
  const issues = [];
  const orig = originalPiece || order?.original_piece || {};
  const repl = replacementPiece || order?.replacement_piece || {};

  // 1. Validação de Status (Bloqueia APENAS se estiver cancelada)
  if (!order || order.status === 'cancelled') {
    issues.push('Etiqueta bloqueada. A ordem de reposição foi CANCELADA.');
  }

  // 2. Número de Rastreio
  const traceCode = repl.traceability_code || repl.piece_uid || buildReplacementTraceCode(orig, 1);
  if (!traceCode || traceCode.includes('null') || traceCode.includes('undefined')) {
    issues.push('Número de rastreio da peça substituta ausente ou inválido.');
  }

  // 3. Lote Geral
  const generalLot = order?.lot_code || orig.general_lot_code || orig.lot_code || orig.lot?.general_lot_code;
  if (!generalLot || String(generalLot).trim() === '' || generalLot === 'N/A') {
    issues.push('Lote Geral da produção não localizado.');
  }

  // 4. Lote do Cliente
  const customerLot = order?.order_number || orig.customer_lot_code || orig.order_number || order?.customer_name;
  if (!customerLot || String(customerLot).trim() === '' || customerLot === 'N/A') {
    issues.push('Lote do Cliente / Pedido não localizado.');
  }

  // 5. Descrição do Produto
  const description = orig.piece_name || orig.description || order?.notes || order?.defect_name || orig.piece_code;
  if (!description || String(description).trim() === '') {
    issues.push('Descrição do produto / peça não vinculada.');
  }

  return {
    isValid: issues.length === 0,
    issues,
    traceCode,
    generalLot: generalLot || 'PENDENTE',
    customerLot: customerLot || 'PENDENTE',
    description: description || 'Sem descrição'
  };
}

/**
 * Registra a impressão ou reimpressão no banco de dados via RPC seguro register_replacement_label_print
 */
export async function recordReplacementLabelPrint({
  replacementOrderId,
  reprintReason = null,
  reprintReasonDetails = null,
  printerName = 'Impressora Térmica Padrão',
  userName = 'Operador MES',
  clientEventId = null
}) {
  if (!replacementOrderId) {
    throw new Error('ID da ordem de reposição é obrigatório.');
  }

  const { data, error } = await supabase.rpc('register_replacement_label_print', {
    p_replacement_request_id: replacementOrderId,
    p_reprint_reason: reprintReason,
    p_reprint_reason_details: reprintReasonDetails,
    p_printer_name: printerName,
    p_user_name: userName,
    p_client_event_id: clientEventId
  });

  if (error) {
    console.error('Erro RPC register_replacement_label_print:', error);
    throw new Error(error.message || 'Falha ao registrar impressão no banco de dados.');
  }

  if (data && !data.success) {
    throw new Error(data.error || 'Não foi possível autorizar a impressão.');
  }

  // Auditoria
  await auditLog({
    action: AUDIT_ACTIONS.LABEL_PRINT || 'LABEL_PRINT',
    entity: 'replacement_orders',
    entityId: replacementOrderId,
    details: {
      copy_number: data.copy_number,
      is_reprint: data.is_reprint,
      reprint_reason: reprintReason,
      printer_name: printerName,
      trace_code: data.replacement_trace_code
    }
  });

  return data;
}

/**
 * Busca o histórico de impressões de uma reposição específica
 */
export async function getReplacementLabelPrintHistory(replacementOrderId) {
  const { data, error } = await supabase
    .from('replacement_label_prints')
    .select('*')
    .eq('replacement_request_id', replacementOrderId)
    .order('printed_at', { ascending: false });

  if (error) {
    console.error('Erro ao buscar histórico de impressões:', error);
    return [];
  }
  return data || [];
}

/**
 * Busca todo o histórico auditável de impressões e exportações do sistema
 */
export async function getAllPrintAndExportHistory({
  type = 'all', // 'all' | 'labels' | 'reports'
  search = null,
  startDate = null,
  endDate = null,
  limit = 50,
  offset = 0
} = {}) {
  let labelPrints = [];
  let reportExports = [];

  if (type === 'all' || type === 'labels') {
    let q = supabase
      .from('replacement_label_prints')
      .select(`
        *,
        replacement_order:replacement_request_id (
          id, replacement_code, lot_code, order_number, customer_name, status, priority, defect_name,
          original_piece:original_piece_id (
            piece_name, description, material, thickness, color
          )
        )
      `)
      .order('printed_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search && search.trim()) {
      const term = search.trim();
      q = q.or(`reprint_reason.ilike.%${term}%,printer_name.ilike.%${term}%,printed_by_name.ilike.%${term}%`);
    }

    const { data, error } = await q;
    if (!error) labelPrints = data || [];
  }

  if (type === 'all' || type === 'reports') {
    let q = supabase
      .from('replacement_report_exports')
      .select('*')
      .order('generated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search && search.trim()) {
      const term = search.trim();
      q = q.or(`report_code.ilike.%${term}%,generated_by_name.ilike.%${term}%`);
    }

    const { data, error } = await q;
    if (!error) reportExports = data || [];
  }

  return {
    labelPrints,
    reportExports
  };
}

/**
 * Busca todos os modelos de etiquetas cadastrados
 */
export async function getLabelTemplates() {
  const { data, error } = await supabase
    .from('label_templates')
    .select('*')
    .eq('is_active', true)
    .order('is_default', { ascending: false });

  if (error) {
    console.error('Erro ao carregar modelos de etiqueta:', error);
    return [
      { id: 'default', name: 'Reposição Promob 100 × 50 mm', width_mm: 100, height_mm: 50, orientation: 'landscape', is_default: true }
    ];
  }
  return data || [];
}
