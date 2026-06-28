/**
 * AC.Prod — Serviço de Histórico de Produção com Paginação Real
 *
 * Substitui os limites fixos de 50/30 registros por paginação real com
 * contagem total no banco (count: 'exact' do Supabase).
 */

import { supabase } from '@/lib/supabaseClient';

// ─── Production Entries ───────────────────────────────────────────────────────

/**
 * Busca entradas de produção com paginação e filtros.
 * @param {object} filters
 * @param {number} page — 0-indexed
 * @param {number} pageSize
 * @returns {{ data: object[], total: number, page: number, pageSize: number }}
 */
export async function fetchProductionEntriesPage(filters = {}, page = 0, pageSize = 20) {
  let q = supabase
    .from('production_entries')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  q = applyEntryFilters(q, filters);

  const { data, error, count } = await q;
  if (error) throw error;

  return { data: data || [], total: count ?? 0, page, pageSize };
}

/**
 * Conta total de entradas com filtros.
 */
export async function countProductionEntries(filters = {}) {
  let q = supabase
    .from('production_entries')
    .select('id', { count: 'exact', head: true });

  q = applyEntryFilters(q, filters);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

function applyEntryFilters(q, filters) {
  if (filters.date) q = q.eq('date', filters.date);
  if (filters.dateFrom) q = q.gte('date', filters.dateFrom);
  if (filters.dateTo) q = q.lte('date', filters.dateTo);
  if (filters.cell) q = q.eq('cell', filters.cell);
  if (filters.shift) q = q.eq('shift', filters.shift);
  if (filters.operator) q = q.ilike('operator', `%${filters.operator}%`);
  if (filters.lotCode) q = q.ilike('lot_code', `%${filters.lotCode}%`);
  if (filters.orderNumber) q = q.ilike('order_number', `%${filters.orderNumber}%`);
  if (filters.productName) q = q.ilike('product_name', `%${filters.productName}%`);
  return q;
}

// ─── Production Stage Readings ────────────────────────────────────────────────

/**
 * Busca leituras de coleta com paginação e filtros.
 */
export async function fetchStageReadingsPage(filters = {}, page = 0, pageSize = 30) {
  let q = supabase
    .from('production_stage_readings')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  q = applyReadingFilters(q, filters);

  const { data, error, count } = await q;
  if (error) throw error;

  return { data: data || [], total: count ?? 0, page, pageSize };
}

/**
 * Conta total de leituras com filtros.
 */
export async function countStageReadings(filters = {}) {
  let q = supabase
    .from('production_stage_readings')
    .select('id', { count: 'exact', head: true });

  q = applyReadingFilters(q, filters);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

function applyReadingFilters(q, filters) {
  if (filters.date) q = q.eq('date', filters.date);
  if (filters.dateFrom) q = q.gte('date', filters.dateFrom);
  if (filters.dateTo) q = q.lte('date', filters.dateTo);
  if (filters.cellName) q = q.eq('cell_name', filters.cellName);
  if (filters.shift) q = q.eq('shift', filters.shift);
  if (filters.operator) q = q.ilike('operator', `%${filters.operator}%`);
  if (filters.tagValue) q = q.ilike('tag_value', `%${filters.tagValue}%`);
  if (filters.status) q = q.eq('status', filters.status);
  if (filters.lotId) q = q.eq('lot_id', filters.lotId);
  if (filters.stepName) q = q.eq('step_name', filters.stepName);
  return q;
}

// ─── Contexto de coleta por lote/pedido ──────────────────────────────────────

/**
 * Busca o contexto de coleta enriquecido (lote + pedido + contagens).
 * @param {string|null} lotId
 * @param {string|null} orderId
 */
export async function fetchCollectionContextSummary(lotId = null, orderId = null) {
  const { data, error } = await supabase.rpc('get_collection_context_summary', {
    p_lot_id: lotId || null,
    p_order_id: orderId || null,
  });
  if (error) throw error;
  return data;
}

// ─── Registro de ocorrência vinculada a leitura ───────────────────────────────

/**
 * Registra ocorrência vinculada a uma leitura específica.
 */
export async function registerReadingOccurrence(payload) {
  const { data, error } = await supabase.rpc('register_reading_occurrence', {
    p_payload: payload,
  });
  if (error) throw new Error(`Falha ao registrar ocorrência: ${error.message}`);
  return data;
}
