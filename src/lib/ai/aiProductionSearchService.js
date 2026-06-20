import { supabase } from '@/lib/supabaseClient';
import { normalizeText } from '@/lib/assistant/assistantEngine';
import { resolveProductionContext } from '@/lib/productionLookupService';

const MONTHS = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };

function dateFromPt(value) {
  const match = String(value || '').toLowerCase().match(/(\d{1,2})[-/ ]([a-z]{3}|\d{1,2})[-/ ](\d{2,4})/);
  if (!match) return '';
  const month = Number.isNaN(Number(match[2])) ? MONTHS[match[2]] : Number(match[2]) - 1;
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  if (month == null || month < 0 || month > 11) return '';
  return new Date(Date.UTC(year, month, Number(match[1]))).toISOString().slice(0, 10);
}

export function parseProductionQuestion(prompt = '') {
  const normalized = normalizeText(prompt);
  const capture = (pattern) => String(prompt).match(pattern)?.[1]?.replace(/[.,;!?]+$/, '').trim() || '';
  const report = /\b(gere|gerar|crie|emitir|exporte)\b.*\brelatorio\b|\brelatorio\b.*\b(carga|pedido|lote|cliente)\b/.test(normalized);
  return {
    type: report ? 'report' : 'search',
    order: capture(/\bpedido\s*(?:n[ºo°.]*)?\s*[:#-]?\s*([a-z0-9._/-]+)/i),
    lot: capture(/\blote\s*(?:n[ºo°.]*)?\s*[:#-]?\s*([a-z0-9._/-]+)/i),
    load: capture(/\bcarga\s*(?:n[ºo°.]*)?\s*[:#-]?\s*([a-z0-9._/-]+)/i),
    pallet: capture(/\bpallet\s*(?:n[ºo°.]*)?\s*[:#-]?\s*([a-z0-9._/-]+)/i),
    customer: capture(/\b(?:cliente|raz[aã]o social)\s+(.+?)(?:\s+(?:est[aã]o|com|pendentes?|no|na|em|finalizam)|$)/i),
    product: capture(/\bproduto\s+(.+?)(?:\s+(?:do|da|no|na|em|finaliza)|$)/i),
    route: capture(/\broteiro\s+(.+?)(?:\s+(?:do|da|no|na|em)|$)/i),
    stage: /\bmarcenaria\b/.test(normalized) ? 'joinery' : capture(/\b(?:etapa|c[eé]lula)\s+([\p{L}0-9._/-]+)/iu),
    finalizationDate: dateFromPt(prompt),
    pending: /\b(pendente|pendentes|aguardando)\b/.test(normalized),
    rejected: /\b(reprovad|rejeitad|refugo)/.test(normalized),
    approved: /\b(aprovad)/.test(normalized),
    late: /\b(atrasad)/.test(normalized),
    occurrence: /\b(ocorrencia|parada|falha)\b/.test(normalized),
    period: /\bmes\b/.test(normalized) ? 'month' : /\bhoje\b/.test(normalized) ? 'today' : '',
    rawPrompt: prompt,
  };
}

export function buildProductionFilters(intent = {}) {
  const now = new Date();
  let startDate = '';
  let endDate = '';
  if (intent.period === 'month') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    endDate = now.toISOString().slice(0, 10);
  } else if (intent.period === 'today') {
    startDate = endDate = now.toISOString().slice(0, 10);
  }
  return {
    order: intent.order,
    lots: intent.lot ? [intent.lot] : [],
    loadNumber: intent.load,
    palletNumber: intent.pallet,
    client: intent.customer,
    product: intent.product,
    route: intent.route,
    stage: intent.stage,
    finalizationDate: intent.finalizationDate,
    status: intent.pending ? 'pending' : intent.late ? 'late' : '',
    approvalStatus: intent.rejected ? 'rejected' : intent.approved ? 'approved' : '',
    onlyWithOccurrence: intent.occurrence,
    startDate,
    endDate,
  };
}

async function listLotsForOrder(orderId) {
  let result = await supabase.from('production_lots').select('*').eq('production_order_id', orderId).order('created_at', { ascending: false });
  if (result.error) result = await supabase.from('production_lots').select('*').eq('order_id', orderId).order('created_at', { ascending: false });
  return result.error ? [] : result.data || [];
}

export async function searchProductionContext(filters = {}) {
  const direct = filters.palletNumber
    ? await resolveProductionContext({ value: filters.palletNumber, type: 'pallet' })
    : filters.loadNumber
      ? await resolveProductionContext({ value: filters.loadNumber, type: 'load' })
      : filters.order
        ? await resolveProductionContext({ value: filters.order, type: 'order' })
        : filters.lots?.[0]
          ? await resolveProductionContext({ value: filters.lots[0], type: 'lot' })
          : null;

  if (direct?.contextFound && !filters.loadNumber) {
    return { orders: direct.productionOrder ? [direct.productionOrder] : [], lots: direct.lot ? [direct.lot] : [], items: direct.item ? [direct.item] : [], contexts: [direct], warnings: direct.warnings || [] };
  }

  let query = supabase.from('production_orders').select('*').order('created_at', { ascending: false }).limit(500);
  if (filters.loadNumber) query = query.ilike('load_number', filters.loadNumber);
  if (filters.client) query = query.or(`customer_legal_name.ilike.%${filters.client.replaceAll(',', ' ')}%,customer_trade_name.ilike.%${filters.client.replaceAll(',', ' ')}%,customer_name.ilike.%${filters.client.replaceAll(',', ' ')}%`);
  if (filters.finalizationDate) query = query.eq('finalization_date', filters.finalizationDate);
  const { data: orders = [], error } = await query;
  if (error) return { orders: [], lots: [], items: [], contexts: [], warnings: [`A busca avançada requer a migração 014: ${error.message}`] };

  const lots = [];
  for (const order of orders) lots.push(...await listLotsForOrder(order.id));
  let items = [];
  if (orders.length) {
    const itemResult = await supabase.from('production_order_items').select('*').in('production_order_id', orders.map((order) => order.id)).limit(2000);
    if (!itemResult.error) items = itemResult.data || [];
  }
  let filteredLots = lots;
  if (filters.stage) filteredLots = filteredLots.filter((lot) => normalizeText(lot.current_step || lot.current_stage).includes(normalizeText(filters.stage)));
  if (filters.status === 'pending') filteredLots = filteredLots.filter((lot) => Number(lot.pending_quantity || 0) > 0 || ['planned','released','in_progress','partial'].includes(lot.status));
  if (filters.status === 'late') filteredLots = filteredLots.filter((lot) => {
    const order = orders.find((item) => item.id === (lot.production_order_id || lot.order_id));
    const due = order?.finalization_date || order?.delivery_date;
    return due && new Date(`${due}T23:59:59`) < new Date() && !['shipped','cancelled'].includes(lot.status);
  });
  if (filters.approvalStatus === 'rejected') filteredLots = filteredLots.filter((lot) => Number(lot.rejected_quantity || lot.scrap_count || 0) > 0);
  if (filters.product) items = items.filter((item) => normalizeText(`${item.product_code || ''} ${item.product_name || ''}`).includes(normalizeText(filters.product)));
  if (filters.route) items = items.filter((item) => normalizeText(`${item.route_code || ''} ${item.route_name || ''}`).includes(normalizeText(filters.route)));
  if (filters.palletNumber) items = items.filter((item) => String(item.pallet_number || '').includes(filters.palletNumber));
  return { orders, lots: filteredLots, items, contexts: [], warnings: [] };
}

function summarizeSearch(result, filters) {
  if (!result.orders.length && !result.lots.length) return `Não encontrei registros para os filtros informados.${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`;
  const lines = [`Encontrei ${result.orders.length} pedido(s) e ${result.lots.length} lote(s).`];
  result.orders.slice(0, 12).forEach((order) => {
    const orderLots = result.lots.filter((lot) => (lot.production_order_id || lot.order_id) === order.id);
    lines.push(`• Pedido ${order.order_number || order.order_code} · Carga ${order.load_number || 'não informada'} · ${order.customer_legal_name || order.customer_name || 'cliente não informado'} · ${orderLots.length} lote(s)`);
  });
  if (result.items.length) {
    lines.push('Produtos:');
    result.items.slice(0, 12).forEach((item) => lines.push(`• ${item.product_code || 'sem código'} · ${item.product_name || 'sem descrição'} · Pallet ${item.pallet_number || 'não informado'} · ${item.route_name || 'roteiro não informado'}`));
  }
  if (filters.stage) lines.push(`Etapa filtrada: ${filters.stage}.`);
  if (filters.finalizationDate) lines.push(`Finalização: ${filters.finalizationDate}.`);
  return lines.join('\n');
}

export async function answerProductionQuestion(prompt, userContext = {}) {
  const intent = parseProductionQuestion(prompt);
  const filters = buildProductionFilters(intent);
  const result = await searchProductionContext(filters);
  return {
    content: summarizeSearch(result, filters),
    actions: [{ label: 'Abrir IA Operacional', path: '/ia-operacional' }, { label: 'Abrir Rastreabilidade', path: '/rastreabilidade' }],
    productionFilters: filters,
    reportRequest: intent.type === 'report' ? await generateProductionReportFromPrompt(prompt, userContext) : null,
  };
}

export async function generateProductionReportFromPrompt(prompt, userContext = {}) {
  const intent = parseProductionQuestion(prompt);
  const filters = buildProductionFilters(intent);
  return {
    reportType: filters.lots.length ? 'lot_traceability' : 'production_summary',
    format: 'pdf',
    title: filters.loadNumber ? `Relatório da Carga ${filters.loadNumber}` : filters.order ? `Relatório do Pedido ${filters.order}` : 'Relatório Produtivo',
    filters,
    requestedBy: userContext.user?.id || null,
  };
}

export function isProductionSearchQuestion(prompt = '') {
  const normalized = normalizeText(prompt);
  return /\b(carga|pallet|razao social|cliente|produto|roteiro|finaliza|reprovad|rejeitad|pendente|atrasad|marcenaria)\b/.test(normalized)
    || /\b(quais|mostre|liste|gere|gerar)\b.*\b(pedidos?|lotes?|relatorio)\b/.test(normalized);
}
