import { supabase } from '@/lib/supabaseClient';
import { canonicalProductionStage } from '@/lib/productionStagePolicyService';

function createClientEventId() {
  if (globalThis.crypto?.randomUUID) {
    return `manual-volume-${globalThis.crypto.randomUUID()}`;
  }
  return `manual-volume-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeActiveLot(batch, stageProgress = null) {
  const code = String(batch.general_lot_code || '').trim().toUpperCase();
  return {
    id: batch.id,
    batchId: batch.id,
    code,
    general_lot_code: code,
    status: batch.status,
    totalParts: Number(batch.total_parts) || 0,
    completedParts: Number(batch.completed_parts) || 0,
    pendingParts: Number(batch.pending_parts) || 0,
    progressPercent: Number(batch.progress_percent) || 0,
    importedAt: batch.imported_at || batch.created_at,
    customerName: batch.customer_name || '',
    orderCode: batch.order_code || '',
    stageProgress,
  };
}

/**
 * Registra uma baixa por volume para um Lote Geral importado e ativo.
 * A RPC é a única fonte de escrita e não cria peça/leitura sintética.
 */
export async function registerManualQuantitativeEntry(payload = {}) {
  const generalLotCode = String(
    payload.general_lot_code || payload.lote_geral || payload.lot_code || '',
  ).trim().toUpperCase();
  const pcpImportBatchId = String(
    payload.pcp_import_batch_id || payload.batch_id || '',
  ).trim();
  const cellName = String(payload.cell_name || payload.celula || '').trim();
  const quantity = Number(payload.quantity ?? payload.quantidade);

  if (!generalLotCode || !pcpImportBatchId) {
    throw new Error('Selecione um Lote Geral ativo na lista.');
  }
  if (!cellName) {
    throw new Error('Selecione a célula produtiva.');
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('A quantidade produzida deve ser um número inteiro maior que zero.');
  }

  const requestPayload = {
    pcp_import_batch_id: pcpImportBatchId,
    general_lot_code: generalLotCode,
    cell_name: cellName,
    stage_code: canonicalProductionStage(cellName),
    shift: String(payload.shift || '1º Turno').trim(),
    operator: String(payload.operator || payload.operator_name || 'Operador Manual').trim(),
    quantity,
    unit_of_measure: 'pecas',
    notes: String(payload.notes || payload.observacao || '').trim(),
    date: payload.date || new Date().toISOString().slice(0, 10),
    client_event_id: payload.client_event_id || createClientEventId(),
  };

  const { data, error } = await supabase.rpc('register_untraceable_stage_quantity', {
    p_payload: requestPayload,
  });

  if (error) {
    throw new Error(error.message || 'Não foi possível registrar a baixa por volume.');
  }
  if (!data?.success) {
    throw new Error(data?.error || 'A baixa por volume foi recusada pelo banco de dados.');
  }

  return {
    ...data,
    success: true,
    general_lot_code: data.general_lot_code || generalLotCode,
    pcp_import_batch_id: data.batch_id || pcpImportBatchId,
    quantity,
    unit_of_measure: 'pecas',
    cascade: false,
    is_manual: true,
    is_untraceable: true,
    traceability_type: 'aggregate_untraceable',
  };
}

/**
 * Busca somente Lotes Gerais importados e ainda ativos.
 * A seleção usa o UUID do lote para impedir baixa em código digitado livremente.
 */
export async function fetchAvailableGeneralLots(limit = 100, options = {}) {
  const stageCode = canonicalProductionStage(options.cellName);
  const { data: batches, error } = await supabase
    .from('promob_import_batches')
    .select(`
      id,
      general_lot_code,
      status,
      total_parts,
      completed_parts,
      pending_parts,
      progress_percent,
      customer_name,
      order_code,
      imported_at,
      created_at
    `)
    .not('general_lot_code', 'is', null)
    .not('status', 'in', '("cancelled","error","duplicated","failed_validation")')
    .order('imported_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Não foi possível carregar os Lotes Gerais ativos: ${error.message}`);
  }

  const activeBatches = (batches || []).filter((batch) => (
    String(batch.general_lot_code || '').trim()
    && Number(batch.progress_percent || 0) < 100
  ));

  const rows = await Promise.all(activeBatches.map(async (batch) => {
    const { data: progress, error: progressError } = await supabase.rpc(
      'get_lot_route_stage_progress',
      { p_batch_id: batch.id },
    );
    if (progressError) return normalizeActiveLot(batch);

    const stageProgress = Array.isArray(progress?.batch_stages)
      ? progress.batch_stages.find((stage) => stage.stage_code === stageCode) || null
      : null;
    return normalizeActiveLot(batch, stageProgress);
  }));

  return rows.filter((lot) => {
    if (!stageCode || !lot.stageProgress) return true;
    return Number(lot.stageProgress.required_pieces || 0) > 0
      && Number(lot.stageProgress.remaining_pieces || 0) > 0;
  });
}

/**
 * Busca histórico recente de entradas e baixas manuais para controle e auditoria.
 */
export async function listManualEntries({ date = null, cellName = null, limit = 50 } = {}) {
  try {
    let query = supabase
      .from('manual_production_records')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (date) {
      query = query.gte('created_at', `${date}T00:00:00`).lte('created_at', `${date}T23:59:59`);
    }
    if (cellName) {
      query = query.ilike('cell_name', cellName);
    }

    const { data, error } = await query;
    if (!error && data && data.length > 0) {
      return data;
    }
  } catch (err) {
    console.warn('Consulta em manual_production_records:', err?.message);
  }

  // Fallback para production_entries
  try {
    let fallbackQuery = supabase
      .from('production_entries')
      .select('*')
      .eq('is_manual', true)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (date) {
      fallbackQuery = fallbackQuery.eq('date', date);
    }

    const { data: fallbackData } = await fallbackQuery;
    if (fallbackData && fallbackData.length > 0) {
      return fallbackData.map((d) => ({
        id: d.id,
        created_at: d.created_at,
        general_lot_code: d.lot_code || d.order_number || '---',
        cell_name: d.cell,
        shift: d.shift,
        quantity: d.produced,
        unit_of_measure: d.unit_of_measure || 'pecas',
        operator: d.operator,
        type: 'baixa',
      }));
    }
  } catch (err) {
    console.warn('Fallback em production_entries:', err?.message);
  }

  return [];
}
