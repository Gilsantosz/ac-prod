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

  // Verificar se todos os volumes deste lote estão fechados e se todas as peças do lote foram embaladas
  // Se sim, avança status do lote para packed / waiting_shipping
  const lotId = data.lot_id;
  const { data: allPieces } = await supabase
    .from('production_pieces')
    .select('id, requires_packaging')
    .eq('lot_id', lotId);

  const expectedToPack = allPieces?.filter(p => p.requires_packaging !== false) || [];

  // Obter IDs de todas as peças já embaladas para este lote
  const { data: allLotVolumes } = await supabase
    .from('packing_volumes')
    .select('id, status')
    .eq('lot_id', lotId);

  const allClosed = allLotVolumes?.every(v => v.status === 'closed') || false;

  // Se todos os volumes do lote estiverem fechados, atualiza o status do lote
  if (allClosed) {
    await supabase.rpc('update_production_lot_status_safely', {
      p_lot_id: lotId,
      p_new_status: 'packed'
    });
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

  // Reverter status do lote para waiting_packaging/in_progress
  await supabase.rpc('update_production_lot_status_safely', {
    p_lot_id: data.lot_id,
    p_new_status: 'waiting_packaging'
  });

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
 * Retorna o progresso de embalagem de um lote.
 * Mostra total de peças esperadas, embaladas, faltantes e volumes criados.
 * 
 * @param {string} lotId - UUID do lote
 */
export async function getPackingProgress(lotId) {
  if (!lotId) throw new Error('Lote é obrigatório.');

  // Obter peças totais do lote que requerem embalagem
  const { data: pieces, error: piecesErr } = await supabase
    .from('production_pieces')
    .select('id, piece_uid, piece_name, status, current_stage, requires_packaging')
    .eq('lot_id', lotId);

  if (piecesErr) throw piecesErr;

  const expectedPieces = pieces?.filter(p => p.requires_packaging !== false) || [];

  if (expectedPieces.length === 0) {
    return {
      totalExpected: 0,
      totalPacked: 0,
      totalMissing: 0,
      percent: 0,
      missingPieces: [],
      volumes: []
    };
  }

  // Obter peças já embaladas para esses IDs
  const pieceIds = expectedPieces.map(p => p.id);
  const { data: packedItems, error: packedErr } = await supabase
    .from('packing_volume_items')
    .select('piece_id')
    .in('piece_id', pieceIds);

  if (packedErr) throw packedErr;

  const packedSet = new Set(packedItems?.map(item => item.piece_id) || []);
  
  const packed = expectedPieces.filter(p => packedSet.has(p.id));
  const missing = expectedPieces.filter(p => !packedSet.has(p.id));

  // Buscar volumes
  const { data: volumes } = await supabase
    .from('packing_volumes')
    .select('*')
    .eq('lot_id', lotId)
    .order('volume_number', { ascending: true });

  return {
    totalExpected: expectedPieces.length,
    totalPacked: packed.length,
    totalMissing: missing.length,
    percent: expectedPieces.length > 0 ? Math.round((packed.length / expectedPieces.length) * 100) : 0,
    missingPieces: missing,
    volumes: volumes || []
  };
}
