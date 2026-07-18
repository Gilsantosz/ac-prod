/**
 * AC.Prod MES — Service de Expedição (Checklist & Barreiras)
 * 
 * Garante que nenhum lote ou pedido seja marcado como "shipped" sem conferência física 100%
 * de volumes e peças avulsas, ou com exceção devidamente assinada por gerente/admin.
 */

import { supabase } from '@/lib/supabaseClient';

/**
 * Cria o checklist de expedição para uma remessa (shipment).
 * Popula a tabela shipment_items com todos os volumes fechados do lote e as peças avulsas (não embaladas).
 * 
 * @param {string} shipmentId - UUID da remessa
 */
export async function createShipmentChecklist(shipmentId) {
  if (!shipmentId) throw new Error('Shipment ID é obrigatório.');

  const { data: shipment, error: shipErr } = await supabase
    .from('shipments')
    .select('lot_id, order_id, customer_cover_id')
    .eq('id', shipmentId)
    .single();

  if (shipErr) throw shipErr;

  const lotId = shipment.lot_id;
  const coverId = shipment.customer_cover_id;

  let lotIds = [];
  if (coverId) {
    const { data: coverLots } = await supabase
      .from('production_lots')
      .select('id')
      .eq('customer_cover_id', coverId);
    lotIds = coverLots?.map(l => l.id) || [];
  } else if (lotId) {
    lotIds = [lotId];
  }

  if (lotIds.length === 0) {
    return { success: true, itemsCount: 0 };
  }

  // 1. Obter todos os volumes fechados
  let volumesQuery = supabase
    .from('packing_volumes')
    .select('id, volume_code')
    .eq('status', 'closed');
  
  if (coverId) {
    volumesQuery = volumesQuery.or(`customer_cover_id.eq.${coverId},lot_id.in.(${lotIds.join(',')})`);
  } else {
    volumesQuery = volumesQuery.eq('lot_id', lotId);
  }
  
  const { data: volumes, error: volumesErr } = await volumesQuery;
  if (volumesErr) throw volumesErr;

  // 2. Obter todas as peças concluídas
  let piecesQuery = supabase
    .from('production_pieces')
    .select('id, traceability_code, requires_packaging, production_order_id, lot_id')
    .eq('status', 'completed');
  
  if (coverId) {
    piecesQuery = piecesQuery.in('lot_id', lotIds);
  } else {
    piecesQuery = piecesQuery.eq('lot_id', lotId);
  }
  
  const { data: allPieces, error: piecesErr } = await piecesQuery;
  if (piecesErr) throw piecesErr;

  // Obter IDs de peças já embaladas para filtrar as avulsas
  const pieceIds = (allPieces || []).map(p => p.id);
  let packedItems = [];
  if (pieceIds.length > 0) {
    const { data, error: packedErr } = await supabase
      .from('packing_volume_items')
      .select('piece_id')
      .in('piece_id', pieceIds);
    if (packedErr) throw packedErr;
    packedItems = data || [];
  }

  const packedSet = new Set(packedItems?.map(item => item.piece_id) || []);
  const loosePieces = (allPieces || []).filter(p => !packedSet.has(p.id));

  const checklistPayload = [];

  // Adicionar volumes esperados
  if (volumes && volumes.length > 0) {
    volumes.forEach(v => {
      checklistPayload.push({
        shipment_id: shipmentId,
        expected_type: 'volume',
        volume_id: v.id,
        traceability_code: v.volume_code,
        status: 'pending'
      });
    });
  }

  // Adicionar peças avulsas esperadas
  loosePieces.forEach(p => {
    checklistPayload.push({
      shipment_id: shipmentId,
      expected_type: 'piece',
      piece_id: p.id,
      traceability_code: p.traceability_code,
      status: 'pending'
    });
  });

  if (checklistPayload.length > 0) {
    const { error: insErr } = await supabase
      .from('shipment_items')
      .upsert(checklistPayload, { onConflict: 'shipment_id,piece_id,volume_id', ignoreDuplicates: true });

    if (insErr) throw insErr;
  }

  return { success: true, itemsCount: checklistPayload.length };
}

/**
 * Bipa um item na expedição (volume ou peça avulsa).
 * Chama a RPC segura que faz a bipagem física e atualiza o checklist.
 * 
 * @param {string} shipmentId - UUID da remessa
 * @param {string} barcode - Código de barras lido
 * @param {string} [operatorId] - UUID do operador
 * @param {string} [deviceId] - ID do coletor
 */
export async function scanShipmentItem(shipmentId, barcode, operatorId = null, deviceId = null) {
  if (!shipmentId) throw new Error('Remessa é obrigatória.');
  if (!barcode) throw new Error('Código de barras é obrigatório.');

  const { data, error } = await supabase.rpc('scan_shipment_item', {
    p_payload: {
      shipment_id: shipmentId,
      barcode: barcode.trim(),
      operator_id: operatorId,
      device_id: deviceId
    }
  });

  if (error) throw new Error(`Erro ao bipar expedição: ${error.message}`);
  if (!data?.success) throw new Error(data?.error || 'Erro na bipagem de expedição.');

  return data;
}

/**
 * Valida se a remessa está completa (100% conferida ou com exceções aprovadas).
 * Retorna true ou false e detalhes.
 * 
 * @param {string} shipmentId - UUID da remessa
 */
export async function validateShipmentCompleteness(shipmentId) {
  if (!shipmentId) throw new Error('Remessa é obrigatória.');

  const { data: items, error } = await supabase
    .from('shipment_items')
    .select('id, status')
    .eq('shipment_id', shipmentId);

  if (error) throw error;
  if (!items || items.length === 0) return { isValid: false, reason: 'Checklist vazio ou não iniciado.' };

  const pendingCount = items.filter(i => i.status === 'pending').length;
  const exceptionsCount = items.filter(i => i.status === 'exception').length;

  return {
    isValid: pendingCount === 0,
    totalItems: items.length,
    pending: pendingCount,
    exceptions: exceptionsCount,
    percent: Math.round(((items.length - pendingCount) / items.length) * 100)
  };
}

/**
 * Libera a expedição fisicamente e altera o status da remessa, do lote e das capas para 'shipped'.
 * Valida a completude do checklist no banco.
 * 
 * @param {string} shipmentId - UUID da remessa
 * @param {string} [notes] - Notas adicionais
 */
export async function releaseShipment(shipmentId, notes = '') {
  if (!shipmentId) throw new Error('Remessa é obrigatória.');

  // Validar se o checklist está 100%
  const validation = await validateShipmentCompleteness(shipmentId);
  if (!validation.isValid) {
    throw new Error(`Expedição bloqueada! Existem ${validation.pending} itens pendentes de bipagem e sem exceção liberada.`);
  }

  // Obter remessa
  const { data: shipment, error: findErr } = await supabase
    .from('shipments')
    .select('id, lot_id, customer_cover_id, shipment_code')
    .eq('id', shipmentId)
    .single();
  
  if (findErr) throw findErr;

  const shippedBy = (await supabase.auth.getUser()).data.user?.id || null;

  // Atualizar a remessa
  const { data: updatedShipment, error: shipErr } = await supabase
    .from('shipments')
    .update({
      status: 'shipped',
      shipped_at: new Date().toISOString(),
      shipped_by: shippedBy,
      notes: notes || null
    })
    .eq('id', shipmentId)
    .select()
    .single();

  if (shipErr) throw shipErr;

  if (shipment.customer_cover_id) {
    const coverId = shipment.customer_cover_id;

    // Atualizar a capa
    await supabase
      .from('customer_covers')
      .update({
        status: 'shipped',
        shipped_at: new Date().toISOString(),
        shipped_by: shippedBy
      })
      .eq('id', coverId);

    // Obter lotes da capa
    const { data: coverLots } = await supabase
      .from('production_lots')
      .select('id, lot_code')
      .eq('customer_cover_id', coverId);
    
    if (coverLots) {
      for (const lot of coverLots) {
        await supabase.rpc('update_production_lot_status_safely', {
          p_lot_id: lot.id,
          p_new_status: 'shipped'
        });

        await supabase.from('lot_step_events').insert({
          lot_id: lot.id,
          step_code: 'shipping',
          event_type: 'finish',
          notes: `Expedição oficial da capa liberada 100% conferida: ${shipment.shipment_code}`,
          quantity: 0
        });
      }
    }

    // Atualizar as peças correspondentes aos lotes da capa
    const lotIds = coverLots?.map(l => l.id) || [];
    if (lotIds.length > 0) {
      await supabase
        .from('production_pieces')
        .update({ current_stage: 'Expedição', status: 'completed' })
        .in('lot_id', lotIds);
    }
  } else if (shipment.lot_id) {
    // Atualizar status do lote de forma segura
    const { error: lotErr } = await supabase.rpc('update_production_lot_status_safely', {
      p_lot_id: shipment.lot_id,
      p_new_status: 'shipped'
    });
    if (lotErr) throw lotErr;

    // Registrar logs produtivos legados para compatibilidade
    await supabase.from('lot_step_events').insert({
      lot_id: shipment.lot_id,
      step_code: 'shipping',
      event_type: 'finish',
      notes: `Expedição oficial liberada 100% conferida: ${shipment.shipment_code}`,
      quantity: 0
    });
  }

  return updatedShipment;
}

/**
 * Cria uma exceção aprovada para um item pendente da expedição.
 * Requer assinatura/ID de perfil de gerente ou administrador.
 * 
 * @param {string} shipmentId - UUID da remessa
 * @param {Object} params - Parâmetros da exceção
 * @param {string} [params.pieceId] - ID da peça
 * @param {string} [params.volumeId] - ID do volume
 * @param {string} params.reason - Motivo da exceção
 */
export async function createShipmentException(shipmentId, params = {}) {
  if (!shipmentId) throw new Error('Remessa é obrigatória.');
  if (!params.reason) throw new Error('Motivo da exceção é obrigatório.');

  const userId = (await supabase.auth.getUser()).data.user?.id;
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();

  if (!['admin', 'manager'].includes(profile?.role)) {
    throw new Error('Apenas gerentes ou administradores podem aprovar exceções de expedição.');
  }

  // Gravar registro de exceção
  const { data: exception, error: excErr } = await supabase
    .from('shipment_exceptions')
    .insert({
      shipment_id: shipmentId,
      piece_id: params.pieceId || null,
      volume_id: params.volumeId || null,
      reason: params.reason,
      approved_by: userId,
      created_by: userId
    })
    .select()
    .single();

  if (excErr) throw excErr;

  // Atualizar status do item no checklist para exception
  let query = supabase
    .from('shipment_items')
    .update({ status: 'exception' })
    .eq('shipment_id', shipmentId);

  if (params.pieceId) query = query.eq('piece_id', params.pieceId);
  if (params.volumeId) query = query.eq('volume_id', params.volumeId);

  const { error: itemErr } = await query;
  if (itemErr) throw itemErr;

  return exception;
}

/**
 * Retorna os itens em falta (pendentes) na expedição.
 * 
 * @param {string} shipmentId - UUID da remessa
 */
export async function getMissingShipmentItems(shipmentId) {
  if (!shipmentId) return [];

  const { data, error } = await supabase
    .from('shipment_items')
    .select(`
      *,
      production_pieces (
        id, piece_uid, piece_name, current_stage, status, 
        production_events ( created_at, operator_id, cell_name )
      ),
      packing_volumes (
        id, volume_code, status
      )
    `)
    .eq('shipment_id', shipmentId)
    .eq('status', 'pending');

  if (error) throw error;
  return data || [];
}

/**
 * Retorna o progresso detalhado de conferência de carga/expedição.
 * 
 * @param {string} shipmentId - UUID da remessa
 */
export async function getShipmentProgress(shipmentId) {
  if (!shipmentId) throw new Error('Remessa é obrigatória.');

  const { data: items, error } = await supabase
    .from('shipment_items')
    .select(`
      *,
      production_pieces ( id, piece_uid, piece_name, current_stage, status ),
      packing_volumes ( id, volume_code )
    `)
    .eq('shipment_id', shipmentId);

  if (error) throw error;

  const total = items?.length || 0;
  const scanned = items?.filter(i => i.status === 'scanned').length || 0;
  const exceptions = items?.filter(i => i.status === 'exception').length || 0;
  const pending = items?.filter(i => i.status === 'pending') || [];

  return {
    total,
    totalItems: total,
    expectedCount: total,
    scanned,
    packedCount: scanned,
    exceptions,
    pendingCount: pending.length,
    pending: pending.length,
    percent: total > 0 ? Math.round(((scanned + exceptions) / total) * 100) : 0,
    pendingItems: pending,
    items: items || []
  };
}
