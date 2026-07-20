import { supabase } from '@/lib/supabaseClient';

/**
 * Registra uma baixa produtiva manual quantitativa associada a um Lote Geral e Célula.
 */
export async function registerManualQuantitativeEntry(payload = {}) {
  const generalLotCode = String(payload.general_lot_code || payload.lote_geral || payload.lot_code || '').trim().toUpperCase();
  const cellName = String(payload.cell_name || payload.celula || '').trim();
  const shift = String(payload.shift || '1º Turno').trim();
  const operator = String(payload.operator || payload.operator_name || 'Operador Manual').trim();
  const quantity = Math.max(1, Number(payload.quantity || payload.quantidade) || 1);
  const unitOfMeasure = String(payload.unit_of_measure || payload.unidade || 'pecas').trim();
  const notes = String(payload.notes || payload.observacao || '').trim();
  const date = payload.date || new Date().toISOString().slice(0, 10);

  if (!generalLotCode) throw new Error('Código do Lote Geral é obrigatório.');
  if (!cellName) throw new Error('Célula produtiva é obrigatória.');

  const formattedPayload = {
    general_lot_code: generalLotCode,
    cell_name: cellName,
    shift,
    operator,
    quantity,
    unit_of_measure: unitOfMeasure,
    notes,
    date,
  };

  // Tenta via RPC atômico no PostgreSQL
  const { data: rpcData, error: rpcError } = await supabase.rpc('register_manual_quantitative_production', {
    p_payload: formattedPayload,
  });

  if (!rpcError && rpcData?.success) {
    return rpcData;
  }

  // Fallback caso a migração ainda não tenha sido aplicada no Supabase Cloud
  console.warn('RPC register_manual_quantitative_production indisponível, executando fallback via cliente:', rpcError?.message);

  // 1. Busca/Cria o Lote
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

  // 3. Insere a leitura manual
  const { data: newReading, error: readingErr } = await supabase
    .from('production_stage_readings')
    .insert({
      piece_id: newPiece.id,
      lot_id: lotId,
      cell_name: cellName,
      step_name: cellName,
      quantity,
      status: 'approved',
      operator,
      shift,
      entry_type: 'manual_quantitativo',
      traceability_type: 'quantitativa_simplificada',
      is_manual: true,
      unit_of_measure: unitOfMeasure,
      general_lot_code: generalLotCode,
      notes,
      created_at: `${date}T${new Date().toISOString().slice(11)}`,
    })
    .select('*')
    .single();
  if (readingErr) throw readingErr;

  // 4. Insere o evento de coleta
  await supabase.from('production_collection_events').insert({
    reading_id: newReading.id,
    piece_id: newPiece.id,
    lot_id: lotId,
    cell_name: cellName,
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

  return {
    success: true,
    reading_id: newReading.id,
    lot_id: lotId,
    piece_id: newPiece.id,
    general_lot_code: generalLotCode,
    cell_name: cellName,
    quantity,
    unit_of_measure: unitOfMeasure,
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

  // Agrupa e desduplica por código de lote geral
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
