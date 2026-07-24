import { supabase } from '@/lib/supabaseClient';

/**
 * Registra uma baixa produtiva manual quantitativa associada a um Lote Geral.
 * Grava na tabela dedicada `manual_production_records` (isolada das baixas por scanner)
 * e atualiza a tabela de indicadores/KPIs `production_entries` em tempo real.
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

  // 1. A RPC é a fonte atômica. Ao obter sucesso, não repetir gravações no
  // fallback legado (isso duplicava baixa, KPI e histórico).
  const { data: rpcData, error: rpcError } = await supabase.rpc('register_manual_quantitative_production', {
    p_payload: {
      general_lot_code: generalLotCode,
      cell_name: cellName,
      shift,
      operator,
      quantity,
      unit_of_measure: unitOfMeasure,
      notes,
      date,
      cascade_all_cells: cascade,
    },
  });

  if (!rpcError && rpcData?.success) {
    return {
      ...rpcData,
      success: true,
      general_lot_code: rpcData.general_lot_code || generalLotCode,
      quantity,
      unit_of_measure: unitOfMeasure,
      cascade,
      target_cells: rpcData.target_cells || (cascade ? ['Corte', 'Bordo', 'Usinagem', 'Embalagem'] : [cellName]),
      is_manual: true,
    };
  }

  if (!rpcError) {
    throw new Error(rpcData?.error || 'A baixa manual foi recusada pelo banco de dados.');
  }

  const missingRpc = rpcError?.code === 'PGRST202'
    || rpcError?.code === '42883'
    || /function .*register_manual_quantitative_production.*does not exist/i.test(rpcError?.message || '');
  if (rpcError && !missingRpc) {
    throw new Error(`Não foi possível registrar a baixa manual: ${rpcError.message}`);
  }

  // Compatibilidade temporária para instalações antigas que ainda não possuem
  // a RPC. Exige sessão autenticada e preserva autoria em todas as escritas.
  const { data: authData, error: authError } = await supabase.auth.getUser();
  const currentUser = authData?.user;
  if (authError || !currentUser) {
    throw new Error('Faça login para registrar uma baixa manual.');
  }

  // 2. Registra na tabela dedicada `manual_production_records`.
  const targetCells = cascade ? ['Corte', 'Bordo', 'Usinagem', 'Embalagem'] : [cellName];
  const currentHourStr = `${String(new Date().getHours()).padStart(2, '0')}:00`;

  const { error: manualRecordError } = await supabase.from('manual_production_records').insert({
    type: 'baixa',
    general_lot_code: generalLotCode,
    cell_name: cellName,
    shift,
    operator,
    quantity,
    unit_of_measure: unitOfMeasure,
    cascade_all_cells: cascade,
    notes: notes || `Baixa manual para ${cellName}`,
    created_at: new Date().toISOString(),
  });
  if (manualRecordError) {
    throw new Error(`Falha ao gravar o histórico da baixa manual: ${manualRecordError.message}`);
  }

  // 3. Atualiza os KPIs/Indicadores diários em `production_entries` para cada célula alvo
  for (const targetCell of targetCells) {
    const { error: productionEntryError } = await supabase.from('production_entries').insert({
      date,
      shift,
      cell: targetCell,
      hour: currentHourStr,
      produced: quantity,
      target: 0,
      scrap: 0,
      downtime: 0,
      operator,
      notes: notes || `Baixa manual em ${targetCell}`,
      order_number: generalLotCode,
      lot_code: generalLotCode,
      entry_mode: 'manual',
      source: 'manual_production_records',
      is_manual: true,
      unit_of_measure: unitOfMeasure,
      created_by: currentUser.id,
      created_at: new Date().toISOString(),
    });
    if (productionEntryError) {
      throw new Error(`Falha ao atualizar o KPI de ${targetCell}: ${productionEntryError.message}`);
    }

    // Opcional: tenta inserir na leitura de estágio sem travar se falhar
    try {
      await supabase.from('production_stage_readings').insert({
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
        notes: notes || `Baixa manual em ${targetCell}`,
        created_at: `${date}T${new Date().toISOString().slice(11)}`,
      });
    } catch (err) {
      // Ignora silenciosamente se houver constraint de peça ou RLS
    }
  }

  // 4. Garante que o lote exista na tabela de lotes para consultas
  try {
    const { data: existingLot } = await supabase
      .from('production_lots')
      .select('id')
      .ilike('lot_code', generalLotCode)
      .limit(1);

    if (!existingLot || existingLot.length === 0) {
      await supabase.from('production_lots').insert({
        lot_code: generalLotCode,
        general_lot_code: generalLotCode,
        total_items: quantity,
        status: 'in_progress',
        created_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    // Ignora se o lote já existia
  }

  return {
    success: true,
    general_lot_code: generalLotCode,
    quantity,
    unit_of_measure: unitOfMeasure,
    cascade,
    target_cells: targetCells,
    is_manual: true,
  };
}

/**
 * Cadastra um novo Lote Geral no PCP/MES (grava em `manual_production_records` e `production_lots`).
 */
export async function registerGeneralLot({ general_lot_code, customer_name, total_parts, notes } = {}) {
  const cleanCode = String(general_lot_code || '').trim().toUpperCase();
  if (!cleanCode) throw new Error('Código do Lote Geral é obrigatório.');

  const parts = Math.max(1, Number(total_parts) || 1);

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    throw new Error('Faça login para cadastrar um Lote Geral.');
  }

  // 1. Ordem de produção
  let orderId = null;
  const { data: existingOrders, error: existingOrderError } = await supabase
    .from('production_orders')
    .select('id')
    .ilike('order_code', cleanCode)
    .limit(1);
  if (existingOrderError) {
    throw new Error(`Falha ao consultar a ordem do Lote Geral: ${existingOrderError.message}`);
  }

  if (existingOrders && existingOrders.length > 0) {
    orderId = existingOrders[0].id;
  } else {
    const { data: newOrder, error: newOrderError } = await supabase
      .from('production_orders')
      .insert({
        order_code: cleanCode,
        customer_name: customer_name || 'Lote Geral PCP (Manual)',
        promob_project_name: `Lote Manual PCP ${cleanCode}`,
        source: 'manual',
        status: 'released',
        notes: notes || 'Cadastrado manualmente',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .maybeSingle();
    if (newOrderError || !newOrder?.id) {
      throw new Error(`Falha ao criar a ordem do Lote Geral: ${newOrderError?.message || 'registro não retornado'}`);
    }
    orderId = newOrder.id;
  }

  // 2. Lote na tabela production_lots
  let lotId = null;
  const { data: existingLots, error: existingLotError } = await supabase
    .from('production_lots')
    .select('id')
    .ilike('lot_code', cleanCode)
    .limit(1);
  if (existingLotError) {
    throw new Error(`Falha ao consultar o Lote Geral: ${existingLotError.message}`);
  }

  if (existingLots && existingLots.length > 0) {
    lotId = existingLots[0].id;
  } else {
    const { data: newLot, error: newLotError } = await supabase
      .from('production_lots')
      .insert({
        order_id: orderId,
        lot_code: cleanCode,
        general_lot_code: cleanCode,
        total_items: parts,
        status: 'in_progress',
        created_at: new Date().toISOString(),
      })
      .select('id')
      .maybeSingle();
    if (newLotError || !newLot?.id) {
      throw new Error(`Falha ao criar o Lote Geral: ${newLotError?.message || 'registro não retornado'}`);
    }
    lotId = newLot.id;
  }

  // 3. Histórico somente após as entidades produtivas existirem.
  const { error: manualRecordError } = await supabase.from('manual_production_records').insert({
    type: 'entry',
    general_lot_code: cleanCode,
    customer_name: customer_name || 'Cliente PCP (Manual)',
    cell_name: 'PCP',
    shift: '1º Turno',
    operator: 'Operador PCP',
    quantity: parts,
    unit_of_measure: 'pecas',
    cascade_all_cells: false,
    notes: notes || 'Cadastro de Lote Geral Manual PCP',
    created_at: new Date().toISOString(),
  });
  if (manualRecordError) {
    throw new Error(`Lote criado, mas o histórico não foi registrado: ${manualRecordError.message}`);
  }

  return { success: true, lot_id: lotId, order_id: orderId, general_lot_code: cleanCode };
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

/**
 * Busca a lista de Lotes Gerais disponíveis no sistema para sugestão/auto-complete.
 */
export async function fetchAvailableGeneralLots(limit = 100) {
  const map = new Map();

  // 1. Busca da tabela dedicada manual_production_records
  try {
    const { data: manualData } = await supabase
      .from('manual_production_records')
      .select('general_lot_code, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    (manualData || []).forEach((item) => {
      const code = String(item.general_lot_code || '').trim().toUpperCase();
      if (code && !map.has(code)) {
        map.set(code, { id: code, code, createdAt: item.created_at });
      }
    });
  } catch (err) {
    console.warn('fetchAvailableGeneralLots manual_production_records:', err?.message);
  }

  // 2. Busca da tabela production_lots
  try {
    const { data: lotData } = await supabase
      .from('production_lots')
      .select('id, lot_code, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    (lotData || []).forEach((item) => {
      const code = String(item.lot_code || '').trim().toUpperCase();
      if (code && !map.has(code)) {
        map.set(code, { id: item.id, code, createdAt: item.created_at });
      }
    });
  } catch (err) {
    console.warn('fetchAvailableGeneralLots production_lots:', err?.message);
  }

  return Array.from(map.values());
}
