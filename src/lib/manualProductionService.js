import { supabase } from '@/lib/supabaseClient';

/**
 * Registra uma baixa produtiva manual quantitativa associada a um Lote Geral.
 * Se cascade_all_cells for verdadeiro ou a célula for 'Embalagem', a baixa é
 * propagada automaticamente para as 4 células: Corte, Bordo, Usinagem e Embalagem.
 */
export async function registerManualQuantitativeEntry(payload = {}) {
  const generalLotCode = String(payload.general_lot_code || payload.lote_geral || payload.lot_code || '').trim().toUpperCase();
  const cellName = String(payload.cell_name || payload.celula || 'Corte').trim();
  const shift = String(payload.shift || '1º Turno').trim();
  const operator = String(payload.operator || payload.operator_name || 'Operador Manual PCP').trim();
  const quantity = Math.max(1, Number(payload.quantity || payload.quantidade) || 1);
  const unitOfMeasure = String(payload.unit_of_measure || payload.unidade || 'pecas').trim();
  const notes = String(payload.notes || payload.observacao || '').trim();
  const date = payload.date || new Date().toISOString().slice(0, 10);
  const cascade = payload.cascade_all_cells ?? (payload.cascade || cellName.toLowerCase() === 'embalagem' || !payload.cell_name);

  if (!generalLotCode) throw new Error('Código do Lote Geral é obrigatório.');

  const formattedPayload = {
    general_lot_code: generalLotCode,
    cell_name: cellName,
    shift,
    operator,
    quantity,
    unit_of_measure: unitOfMeasure,
    notes,
    date,
    cascade_all_cells: cascade,
  };

  // Tenta via RPC atômico no PostgreSQL
  const { data: rpcData, error: rpcError } = await supabase.rpc('register_manual_quantitative_production', {
    p_payload: formattedPayload,
  });

  if (!rpcError && rpcData?.success) {
    return rpcData;
  }

  // Fallback via JS caso a RPC ainda não esteja ativa no banco
  console.warn('RPC register_manual_quantitative_production indisponível, executando fallback com cascata:', rpcError?.message);

  // 0. Busca/Cria a Ordem de Produção (production_orders)
  let orderId = null;
  const { data: existingOrders } = await supabase
    .from('production_orders')
    .select('id')
    .ilike('order_code', generalLotCode)
    .limit(1);

  if (existingOrders && existingOrders.length > 0) {
    orderId = existingOrders[0].id;
  } else {
    const { data: newOrder } = await supabase
      .from('production_orders')
      .insert({
        order_code: generalLotCode,
        customer_name: 'Lote Geral PCP (Digitado)',
        promob_project_name: `Lote Manual PCP ${generalLotCode}`,
        source: 'manual',
        status: 'released',
        notes: notes || 'Lote cadastrado diretamente via Entrada Manual PCP',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .maybeSingle();
    orderId = newOrder?.id || null;
  }

  // 0.1 Cria o registro de importação no PCP (promob_import_batches)
  let batchId = null;
  const { data: existingBatches } = await supabase
    .from('promob_import_batches')
    .select('id')
    .ilike('file_name', `%${generalLotCode}%`)
    .limit(1);

  if (existingBatches && existingBatches.length > 0) {
    batchId = existingBatches[0].id;
  } else {
    const { data: newBatch } = await supabase
      .from('promob_import_batches')
      .insert({
        file_name: `LOTE-MANUAL-${generalLotCode}`,
        original_file_name: `Lote_Manual_${generalLotCode}.manual`,
        file_type: 'manual',
        status: 'processed',
        total_parts: quantity,
        generated_op_id: orderId,
        notes: `Entrada PCP Manual sem Arquivo — Lote ${generalLotCode}`,
        created_at: new Date().toISOString(),
      })
      .select('id')
      .maybeSingle();
    batchId = newBatch?.id || null;
  }

  // 1. Busca/Cria o Lote Geral
  let lotId = null;
  const { data: existingLots } = await supabase
    .from('production_lots')
    .select('id')
    .or(`lot_code.ilike.${generalLotCode},general_lot_code.ilike.${generalLotCode}`)
    .limit(1);

  if (existingLots && existingLots.length > 0) {
    lotId = existingLots[0].id;
  } else {
    const { data: newLot, error: lotErr } = await supabase
      .from('production_lots')
      .insert({
        order_id: orderId,
        lot_code: generalLotCode,
        general_lot_code: generalLotCode,
        total_items: quantity,
        status: 'in_progress',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (lotErr) throw lotErr;
    lotId = newLot.id;
  }

  // 2. Cria Peça Sintética
  const { data: newPiece, error: pieceErr } = await supabase
    .from('production_pieces')
    .insert({
      lot_id: lotId,
      traceability_code: `${generalLotCode}-MANUAL-${Date.now()}`,
      description: `Lançamento Manual Quantitativo — ${generalLotCode}`,
      status: 'in_production',
      created_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (pieceErr) throw pieceErr;

  // 3. Define as células alvo (todas as 4 se cascata = true)
  const targetCells = cascade ? ['Corte', 'Bordo', 'Usinagem', 'Embalagem'] : [cellName];

  for (const targetCell of targetCells) {
    const { data: newReading, error: readingErr } = await supabase
      .from('production_stage_readings')
      .insert({
        piece_id: newPiece.id,
        lot_id: lotId,
        cell_name: targetCell,
        step_name: targetCell,
        quantity,
        status: 'approved',
        operator,
        shift,
        entry_type: 'manual_quantitativo',
        traceability_type: 'quantitativa_simplificada',
        is_manual: true,
        unit_of_measure: unitOfMeasure,
        general_lot_code: generalLotCode,
        notes: notes || `Baixa manual em cascata para ${targetCell}`,
        created_at: `${date}T${new Date().toISOString().slice(11)}`,
      })
      .select('*')
      .single();

    if (readingErr) throw readingErr;

    await supabase.from('production_collection_events').insert({
      reading_id: newReading.id,
      piece_id: newPiece.id,
      lot_id: lotId,
      cell_name: targetCell,
      operator_name: operator,
      shift,
      status: 'approved',
      quantity,
      reader_type: 'manual',
      entry_type: 'manual_quantitativo',
      traceability_type: 'quantitativa_simplificada',
      is_manual: true,
      unit_of_measure: unitOfMeasure,
      general_lot_code: generalLotCode,
      created_at: `${date}T${new Date().toISOString().slice(11)}`,
    });
  }

  return {
    success: true,
    lot_id: lotId,
    piece_id: newPiece.id,
    general_lot_code: generalLotCode,
    quantity,
    unit_of_measure: unitOfMeasure,
    cascade,
    target_cells: targetCells,
    is_manual: true,
  };
}

/**
 * Busca histórico recente de baixas manuais.
 */
export async function listManualEntries({ date = null, cellName = null, limit = 50 } = {}) {
  let query = supabase
    .from('production_stage_readings')
    .select('*, production_lots(lot_code, general_lot_code)')
    .or('is_manual.eq.true,entry_type.eq.manual_quantitativo')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (date) {
    query = query.gte('created_at', `${date}T00:00:00`).lte('created_at', `${date}T23:59:59`);
  }
  if (cellName) {
    query = query.ilike('cell_name', cellName);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('Erro ao buscar baixas manuais:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Busca a lista de Lotes Gerais disponíveis no sistema para sugestão/auto-complete.
 */
export async function fetchAvailableGeneralLots(limit = 100) {
  const { data, error } = await supabase
    .from('production_lots')
    .select('id, lot_code, general_lot_code, total_items, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('Erro ao buscar lotes gerais:', error.message);
    return [];
  }

  const map = new Map();
  (data || []).forEach((item) => {
    const code = String(item.general_lot_code || item.lot_code || '').trim().toUpperCase();
    if (code && !map.has(code)) {
      map.set(code, {
        id: item.id,
        code,
        totalItems: item.total_items || 0,
        createdAt: item.created_at,
      });
    }
  });

  return Array.from(map.values());
}
