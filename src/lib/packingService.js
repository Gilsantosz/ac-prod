/**
 * AC.Prod MES — Service de Embalagem (Scan-to-Pack)
 * 
 * Centraliza as ações físicas de criação, bipagem, exclusão e fechamento de volumes.
 * Respeita a LEI 01 (Isolamento de Segurança Smith) — as escritas críticas passam por RPCs.
 */

import { supabase } from '@/lib/supabaseClient';

/**
 * Cria um novo volume de embalagem para um lote e pedido.
 * 
 * @param {string} lotId - UUID do lote
 * @param {string} orderId - UUID do pedido de produção
 * @returns {Promise<Object>} Volume criado
 */
export async function createVolume(lotId, orderId) {
  if (!lotId) throw new Error('Informe o ID do lote.');

  // Obter contagem de volumes existentes para gerar o número correto
  const { data: existing, error: countErr } = await supabase
    .from('packing_volumes')
    .select('id')
    .eq('lot_id', lotId);

  if (countErr) throw countErr;

  const volumeNumber = (existing?.length || 0) + 1;
  
  // Buscar código do lote para compor o código do volume
  const { data: lot, error: lotErr } = await supabase
    .from('production_lots')
    .select('lot_code')
    .eq('id', lotId)
    .single();

  if (lotErr) throw lotErr;

  const volumeCode = `${lot.lot_code}-V${String(volumeNumber).padStart(3, '0')}`;

  const { data, error } = await supabase
    .from('packing_volumes')
    .insert({
      lot_id: lotId,
      production_order_id: orderId || null,
      volume_code: volumeCode,
      status: 'open',
      created_by: (await supabase.auth.getUser()).data.user?.id || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Falha ao criar volume: ${error.message}`);
  return data;
}

/**
 * Bipa e valida uma peça para dentro do volume.
 * Chama a RPC segura do banco para garantir as regras de bloqueio.
 * 
 * @param {string} volumeId - UUID do volume
 * @param {string} barcode - Código de barras da peça (traceability_code ou piece_uid)
 * @param {string} [operatorId] - UUID do operador
 * @param {string} [deviceId] - Identificação do dispositivo coletor
 */
export async function scanPieceToVolume(volumeId, barcode, operatorId = null, deviceId = null) {
  if (!volumeId) throw new Error('Volume é obrigatório.');
  if (!barcode) throw new Error('Código de barras é obrigatório.');

  const { data, error } = await supabase.rpc('scan_piece_to_volume', {
    p_payload: {
      volume_id: volumeId,
      barcode: barcode.trim(),
      operator_id: operatorId,
      device_id: deviceId
    }
  });

  if (error) throw new Error(`Erro ao bipar peça: ${error.message}`);
  if (!data?.success) throw new Error(data?.error || 'Falha ao adicionar peça ao volume.');

  return data;
}

/**
 * Remove uma peça de um volume.
 * 
 * @param {string} itemId - UUID do packing_volume_items
 */
export async function removePieceFromVolume(itemId) {
  if (!itemId) throw new Error('Item do volume é obrigatório.');

  // Buscar peça antes de remover para reverter estágio e registrar evento
  const { data: item, error: itemErr } = await supabase
    .from('packing_volume_items')
    .select('*, production_pieces(*)')
    .eq('id', itemId)
    .single();

  if (itemErr) throw itemErr;

  const { error: delErr } = await supabase
    .from('packing_volume_items')
    .delete()
    .eq('id', itemId);

  if (delErr) throw delErr;

  // Atualizar estágio da peça de volta para Separation (ou etapa anterior)
  await supabase
    .from('production_pieces')
    .update({ current_stage: 'Separação', status: 'planned' })
    .eq('id', item.piece_id);

  // Registrar evento de remoção/unpack
  await supabase.from('production_events').insert({
    piece_id: item.piece_id,
    traceability_code: item.traceability_code,
    production_order_id: item.production_pieces?.production_order_id,
    lot_id: item.production_pieces?.lot_id,
    event_type: 'unpack',
    from_stage: 'Embalagem',
    to_stage: 'Separação',
    event_status: 'accepted',
    notes: 'Peça removida do volume pelo operador.'
  });

  return { success: true };
}

/**
 * Fecha o volume (somente se tiver pelo menos uma peça).
 * 
 * @param {string} volumeId - UUID do volume
 */
export async function closeVolume(volumeId) {
  if (!volumeId) throw new Error('Volume é obrigatório.');

  // Validar se tem pelo menos uma peça no volume
  const { data: items, error: itemsErr } = await supabase
    .from('packing_volume_items')
    .select('id')
    .eq('volume_id', volumeId);

  if (itemsErr) throw itemsErr;
  if (!items || items.length === 0) {
    throw new Error('Não é possível fechar um volume vazio. Bipe as peças primeiro.');
  }

  const { data, error } = await supabase
    .from('packing_volumes')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: (await supabase.auth.getUser()).data.user?.id || null,
    })
    .eq('id', volumeId)
    .select()
    .single();

  if (error) throw new Error(`Falha ao fechar volume: ${error.message}`);

  const lotId = data.lot_id;
  const coverId = data.customer_cover_id;

  if (coverId) {
    // ─── Fluxo por Capa de Cliente ───
    const { data: coverLots } = await supabase
      .from('production_lots')
      .select('id')
      .eq('customer_cover_id', coverId);
    const lotIds = coverLots?.map(l => l.id) || [];

    const { data: allCoverPieces } = await supabase
      .from('production_pieces')
      .select('id, requires_packaging')
      .in('lot_id', lotIds);
    const expectedToPack = allCoverPieces?.filter(p => p.requires_packaging !== false) || [];

    const { data: allCoverVolumes } = await supabase
      .from('packing_volumes')
      .select('id, status')
      .eq('customer_cover_id', coverId);
    const allClosed = allCoverVolumes?.every(v => v.status === 'closed') || false;

    const coverVolumeIds = allCoverVolumes?.map(v => v.id) || [];
    const { data: packedItems } = await supabase
      .from('packing_volume_items')
      .select('piece_id')
      .in('volume_id', coverVolumeIds);
    const packedSet = new Set(packedItems?.map(item => item.piece_id) || []);

    const allPiecesPacked = expectedToPack.every(p => packedSet.has(p.id));

    if (allClosed && allPiecesPacked) {
      await supabase
        .from('customer_covers')
        .update({ status: 'packed', closed_at: new Date().toISOString() })
        .eq('id', coverId);

      for (const lId of lotIds) {
        await supabase.rpc('update_production_lot_status_safely', {
          p_lot_id: lId,
          p_new_status: 'packed'
        });
      }
    }
  } else if (lotId) {
    // ─── Fluxo Legado por Lote Único ───
    const { data: allPieces } = await supabase
      .from('production_pieces')
      .select('id, requires_packaging')
      .eq('lot_id', lotId);

    const expectedToPack = allPieces?.filter(p => p.requires_packaging !== false) || [];

    const { data: allLotVolumes } = await supabase
      .from('packing_volumes')
      .select('id, status')
      .eq('lot_id', lotId);

    const allClosed = allLotVolumes?.every(v => v.status === 'closed') || false;

    if (allClosed) {
      await supabase.rpc('update_production_lot_status_safely', {
        p_lot_id: lotId,
        p_new_status: 'packed'
      });
    }
  }

  return data;
}

/**
 * Reabre um volume fechado. Exige permissão admin ou manager.
 * 
 * @param {string} volumeId - UUID do volume
 */
export async function reopenVolumeWithPermission(volumeId) {
  if (!volumeId) throw new Error('Volume é obrigatório.');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', (await supabase.auth.getUser()).data.user?.id)
    .single();

  if (!['admin', 'manager'].includes(profile?.role)) {
    throw new Error('Permissão insuficiente. Apenas administradores ou gerentes podem reabrir volumes fechados.');
  }

  const { data, error } = await supabase
    .from('packing_volumes')
    .update({
      status: 'open',
      closed_at: null,
      closed_by: null,
    })
    .eq('id', volumeId)
    .select()
    .single();

  if (error) throw new Error(`Erro ao reabrir volume: ${error.message}`);

  const lotId = data.lot_id;
  const coverId = data.customer_cover_id;

  if (coverId) {
    await supabase
      .from('customer_covers')
      .update({ status: 'packing', closed_at: null, closed_by: null })
      .eq('id', coverId);

    const { data: coverLots } = await supabase
      .from('production_lots')
      .select('id')
      .eq('customer_cover_id', coverId);
    
    if (coverLots) {
      for (const lot of coverLots) {
        await supabase.rpc('update_production_lot_status_safely', {
          p_lot_id: lot.id,
          p_new_status: 'waiting_packaging'
        });
      }
    }
  } else if (lotId) {
    await supabase.rpc('update_production_lot_status_safely', {
      p_lot_id: lotId,
      p_new_status: 'waiting_packaging'
    });
  }

  return data;
}

/**
 * Busca todos os itens (peças) bipados em um volume.
 * 
 * @param {string} volumeId - UUID do volume
 */
export async function getVolumeItems(volumeId) {
  if (!volumeId) return [];

  const { data, error } = await supabase
    .from('packing_volume_items')
    .select(`
      *,
      production_pieces (
        id, piece_uid, piece_name, material, color, thickness, width, height, length
      )
    `)
    .eq('volume_id', volumeId)
    .order('scanned_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Retorna o progresso de embalagem de um lote ou de uma capa de cliente.
 * Mostra total de peças esperadas, embaladas, faltantes e volumes criados.
 */
export async function getPackingProgress(id, isCover = false) {
  if (!id) throw new Error('ID é obrigatório.');

  let pieces = [];
  let piecesErr = null;

  if (isCover) {
    const { data: coverLots, error: lotsErr } = await supabase
      .from('production_lots')
      .select('id')
      .eq('customer_cover_id', id);
    if (lotsErr) throw lotsErr;

    const lotIds = coverLots?.map(l => l.id) || [];
    if (lotIds.length > 0) {
      const res = await supabase
        .from('production_pieces')
        .select('id, piece_uid, piece_name, status, current_stage, requires_packaging')
        .in('lot_id', lotIds);
      pieces = res.data || [];
      piecesErr = res.error;
    }
  } else {
    const res = await supabase
      .from('production_pieces')
      .select('id, piece_uid, piece_name, status, current_stage, requires_packaging')
      .eq('lot_id', id);
    pieces = res.data || [];
    piecesErr = res.error;
  }

  if (piecesErr) throw piecesErr;

  const expectedPieces = pieces?.filter(p => p.requires_packaging !== false) || [];

  let volumesQuery = supabase.from('packing_volumes').select('*');
  if (isCover) {
    volumesQuery = volumesQuery.eq('customer_cover_id', id);
  } else {
    volumesQuery = volumesQuery.eq('lot_id', id);
  }
  const { data: volumes } = await volumesQuery.order('created_at', { ascending: true });

  if (expectedPieces.length === 0) {
    return {
      totalExpected: 0,
      totalPacked: 0,
      totalMissing: 0,
      percent: 0,
      missingPieces: [],
      volumes: volumes || []
    };
  }

  const pieceIds = expectedPieces.map(p => p.id);
  const { data: packedItems, error: packedErr } = await supabase
    .from('packing_volume_items')
    .select('piece_id')
    .in('piece_id', pieceIds);

  if (packedErr) throw packedErr;

  const packedSet = new Set(packedItems?.map(item => item.piece_id) || []);
  
  const packed = expectedPieces.filter(p => packedSet.has(p.id));
  const missing = expectedPieces.filter(p => !packedSet.has(p.id));

  return {
    totalExpected: expectedPieces.length,
    totalPacked: packed.length,
    totalMissing: missing.length,
    percent: expectedPieces.length > 0 ? Math.round((packed.length / expectedPieces.length) * 100) : 0,
    missingPieces: missing,
    volumes: volumes || []
  };
}
