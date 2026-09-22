import { supabase } from '@/lib/supabaseClient';
import { canonicalProductionStage } from '@/lib/productionStagePolicyService';
import { getOperatorSession, getConfirmedOperatorContext } from '@/lib/operatorSessionService';

// Keep the event identity after an uncertain network response. Never store tokens here.
const pendingManualRequests = new Map();
const MANUAL_PROGRESS_CONCURRENCY = 3;

function createClientEventId() {
  if (globalThis.crypto?.randomUUID) return `manual-volume-${globalThis.crypto.randomUUID()}`;
  return `manual-volume-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeActiveLot(batch, stageProgress = null) {
  const code = String(batch.general_lot_code || '').trim().toUpperCase();
  return {
    id: batch.id, batchId: batch.id, code, general_lot_code: code,
    status: batch.status,
    totalParts: Number(batch.total_parts) || 0,
    completedParts: Number(batch.completed_parts) || 0,
    pendingParts: Number(batch.pending_parts) || 0,
    progressPercent: Number(batch.progress_percent) || 0,
    importedAt: batch.imported_at || batch.created_at,
    customerName: batch.customer_name || '', orderCode: batch.order_code || '',
    stageProgress,
  };
}

function manualProductionError(error, fallback) {
  const messages = {
    MANUAL_PRODUCTION_PERMISSION_REQUIRED: 'Seu perfil não tem permissão para registrar baixa manual.',
    MANUAL_PRODUCTION_OUTSIDE_CELL_SCOPE: 'Seu perfil não tem acesso à célula selecionada.',
    MANUAL_PRODUCTION_BATCH_PERMISSION_REQUIRED: 'Seu perfil não tem acesso à consulta dos lotes.',
    MANUAL_PRODUCTION_CELL_NOT_FOUND: 'A célula selecionada não está ativa ou não foi encontrada.',
    MANUAL_PRODUCTION_EVENT_CONFLICT: 'Este lançamento já foi usado com outros dados. Atualize a tela e confira o histórico.',
    OPERATOR_SESSION_INVALID: 'Sessão operacional expirada ou inválida. Entre novamente com o operador.',
    OPERATOR_CONTEXT_REQUIRED: 'Confirme a célula e o posto do operador antes de registrar a baixa.',
  };
  const message = error?.message || error?.error;
  const wrapped = new Error(messages[message] || message || fallback);
  wrapped.code = error?.code;
  return wrapped;
}

/** The quantitative RPC remains the only writer; no synthetic pieces are created. */
export async function registerManualQuantitativeEntry(payload = {}) {
  const generalLotCode = String(payload.general_lot_code || payload.lote_geral || payload.lot_code || '').trim().toUpperCase();
  const pcpImportBatchId = String(payload.pcp_import_batch_id || payload.batch_id || '').trim();
  const cellName = String(payload.cell_name || payload.celula || '').trim();
  const quantity = Number(payload.quantity ?? payload.quantidade);
  if (!generalLotCode || !pcpImportBatchId) throw new Error('Selecione um Lote Geral ativo na lista.');
  if (!cellName) throw new Error('Selecione a célula produtiva.');
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 2147483647) {
    throw new Error('A quantidade produzida deve ser um número inteiro maior que zero e dentro do saldo da etapa.');
  }

  const session = getOperatorSession();
  const context = session ? getConfirmedOperatorContext(session) : null;
  if (session && (!session.token || !session.device_id || !context || session.context_pending
    || context.cellName.trim().toLocaleLowerCase() !== cellName.toLocaleLowerCase())) {
    throw new Error('Confirme a célula e o posto do operador antes de registrar a baixa.');
  }

  const requestPayload = {
    pcp_import_batch_id: pcpImportBatchId, general_lot_code: generalLotCode,
    cell_name: context?.cellName || cellName,
    stage_code: canonicalProductionStage(cellName),
    shift: String(session?.shift || payload.shift || '1º Turno').trim(),
    operator: String(session?.name || payload.operator || payload.operator_name || 'Operador Manual').trim(),
    quantity, unit_of_measure: 'pecas',
    notes: String(payload.notes || payload.observacao || '').trim(),
    date: payload.date || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()),
  };
  const requestKey = JSON.stringify([session?.session_id || 'administrative', payload.client_event_id || null, requestPayload]);
  let pending = pendingManualRequests.get(requestKey);
  if (pending?.promise) return pending.promise;
  if (!pending) {
    pending = { id: payload.client_event_id || createClientEventId(), promise: null };
    pendingManualRequests.set(requestKey, pending);
  }
  requestPayload.client_event_id = pending.id;
  // Resolve credentials only at the RPC boundary, never in the retry identity.
  if (session) {
    requestPayload.operatorSessionToken = session.token;
    requestPayload.deviceId = session.device_id;
  }

  const operation = (async () => {
    const { data, error } = await supabase.rpc('register_untraceable_stage_quantity', { p_payload: requestPayload });
    if (error) throw manualProductionError(error, 'Não foi possível registrar a baixa por volume.');
    if (!data?.success) throw manualProductionError(data, 'O servidor não confirmou a baixa. Tente novamente sem alterar os dados para verificar o mesmo lançamento.');
    pendingManualRequests.delete(requestKey);
    return {
      ...data, success: true,
      general_lot_code: data.general_lot_code || generalLotCode,
      pcp_import_batch_id: data.batch_id || pcpImportBatchId,
      quantity, unit_of_measure: 'pecas', cascade: false,
      is_manual: true, is_untraceable: true, traceability_type: 'aggregate_untraceable',
    };
  })();
  pending.promise = operation;
  try { return await operation; }
  finally { pending.promise = null; }
}

/** Active imported lots, with a scoped stage aggregate instead of per-piece RLS queries. */
export async function fetchAvailableGeneralLots(limit = 100, options = {}) {
  const stageCode = canonicalProductionStage(options.cellName);
  const { data: batches, error } = await supabase
    .from('promob_import_batches')
    .select(`id, general_lot_code, status, total_parts, completed_parts, pending_parts,
      progress_percent, customer_name, order_code, imported_at, created_at`)
    .not('general_lot_code', 'is', null)
    .not('status', 'in', '("cancelled","error","duplicated","failed_validation")')
    .order('imported_at', { ascending: false })
    .limit(Math.max(1, Math.min(100, Number(limit) || 100)));
  if (error) throw new Error(`Não foi possível carregar os Lotes Gerais ativos: ${error.message}`);
  const activeBatches = (batches || []).filter((batch) => (
    String(batch.general_lot_code || '').trim() && Number(batch.progress_percent || 0) < 100
  ));
  if (!stageCode) return activeBatches.map((batch) => normalizeActiveLot(batch));

  const rows = new Array(activeBatches.length);
  let nextIndex = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && nextIndex < activeBatches.length) {
      const index = nextIndex++;
      const batch = activeBatches[index];
      try {
        const { data: progress, error: progressError } = await supabase.rpc(
          'get_manual_volume_stage_progress', { p_batch_id: batch.id, p_cell_name: options.cellName },
        );
        if (progressError) throw manualProductionError(progressError, 'Saldo indisponível.');
        if (!progress || !Object.prototype.hasOwnProperty.call(progress, 'stage_progress')) {
          throw new Error('O servidor não confirmou o saldo da etapa.');
        }
        const stage = progress.stage_progress;
        if (stage && (stage.stage_code !== stageCode
          || !Number.isFinite(Number(stage.required_pieces))
          || !Number.isFinite(Number(stage.remaining_pieces)))) {
          throw new Error('O servidor retornou um saldo inválido para a etapa.');
        }
        rows[index] = normalizeActiveLot(batch, stage);
      } catch (progressError) {
        failed = true;
        // A timeout is not a zero balance. Surface a retryable query error to the panel.
        throw new Error(`Não foi possível consultar o saldo do Lote ${batch.general_lot_code}: ${progressError.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MANUAL_PROGRESS_CONCURRENCY, activeBatches.length) }, worker));
  return rows.filter((lot) => lot?.stageProgress
    && Number(lot.stageProgress.required_pieces) > 0
    && Number(lot.stageProgress.remaining_pieces) > 0);
}

/** Recent manual entries for the existing history screen. */
export async function listManualEntries({ date = null, cellName = null, limit = 50 } = {}) {
  try {
    let query = supabase.from('manual_production_records').select('*').order('created_at', { ascending: false }).limit(limit);
    if (date) query = query.gte('created_at', `${date}T00:00:00`).lte('created_at', `${date}T23:59:59`);
    if (cellName) query = query.ilike('cell_name', cellName);
    const { data, error } = await query;
    if (!error && data && data.length > 0) return data;
  } catch (err) { console.warn('Consulta em manual_production_records:', err?.message); }
  try {
    let query = supabase.from('production_entries').select('*').eq('is_manual', true).order('created_at', { ascending: false }).limit(limit);
    if (date) query = query.eq('date', date);
    if (cellName) query = query.ilike('cell', cellName);
    const { data } = await query;
    if (data && data.length > 0) return data.map((d) => ({
      id: d.id, created_at: d.created_at, general_lot_code: d.lot_code || d.order_number || '---',
      cell_name: d.cell, shift: d.shift, quantity: d.produced,
      unit_of_measure: d.unit_of_measure || 'pecas', operator: d.operator, type: 'baixa',
    }));
  } catch (err) { console.warn('Fallback em production_entries:', err?.message); }
  return [];
}
