/**
 * AC.Prod MES — Service de Capa de Cliente Multi-Lote
 * 
 * Centraliza as ações e consultas para agrupamento de lotes por cliente.
 * Respeita a LEI 01 (Isolamento de Segurança Smith) e as políticas RLS.
 */

import { supabase } from '@/lib/supabaseClient';
import { createShipmentChecklist } from '@/lib/shipmentService';

/**
 * Busca todas as capas de clientes com progresso consolidado.
 */
export async function getCustomerCovers(filters = {}) {
  let query = supabase
    .from('v_customer_cover_summary')
    .select('*')
    .order('customer_name_exact', { ascending: true })
    .order('cover_code', { ascending: true });

  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.search) {
    query = query.or(`customer_name_exact.ilike.%${filters.search}%,cover_code.ilike.%${filters.search}%,general_lot_code.ilike.%${filters.search}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Busca detalhes de uma capa específica, incluindo lotes pertencentes.
 */
export async function getCustomerCoverDetails(coverId) {
  if (!coverId) throw new Error('Capa ID é obrigatório.');

  const { data: cover, error: coverErr } = await supabase
    .from('v_customer_cover_summary')
    .select('*')
    .eq('id', coverId)
    .single();

  if (coverErr) throw coverErr;

  const { data: lots, error: lotsErr } = await supabase
    .from('production_lots')
    .select('*')
    .eq('customer_cover_id', coverId)
    .order('lot_code', { ascending: true });

  if (lotsErr) throw lotsErr;

  return {
    ...cover,
    lots: lots || []
  };
}

/**
 * Retorna o progresso atualizado de uma capa.
 */
export async function getCustomerCoverProgress(coverId) {
  if (!coverId) throw new Error('Capa ID é obrigatório.');

  const { data, error } = await supabase.rpc('get_cover_progress', {
    p_cover_id: coverId
  });

  if (error) throw error;
  return data;
}

/**
 * Cria um novo volume de embalagem para uma capa de cliente.
 */
export async function createCoverVolume(coverId) {
  if (!coverId) throw new Error('Informe o ID da capa.');

  const { data: existing, error: countErr } = await supabase
    .from('packing_volumes')
    .select('id')
    .eq('customer_cover_id', coverId);

  if (countErr) throw countErr;

  const volumeNumber = (existing?.length || 0) + 1;
  
  const { data: cover, error: coverErr } = await supabase
    .from('customer_covers')
    .select('cover_code')
    .eq('id', coverId)
    .single();

  if (coverErr) throw coverErr;

  const volumeCode = `${cover.cover_code}-V${String(volumeNumber).padStart(3, '0')}`;

  const { data, error } = await supabase
    .from('packing_volumes')
    .insert({
      customer_cover_id: coverId,
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
 * Cria uma remessa pendente de expedição (checklist) para a capa.
 */
export async function createCoverShipment(coverId, transportData = {}) {
  if (!coverId) throw new Error('Capa ID é obrigatório.');

  const { data: cover, error: coverErr } = await supabase
    .from('customer_covers')
    .select('cover_code')
    .eq('id', coverId)
    .single();

  if (coverErr) throw coverErr;

  const shipmentCode = `SHIP-${cover.cover_code}`;

  const { data: shipment, error: shipErr } = await supabase
    .from('shipments')
    .insert({
      customer_cover_id: coverId,
      shipment_code: shipmentCode,
      carrier: transportData.carrier || '',
      vehicle: transportData.vehicle || '',
      driver: transportData.driver || '',
      tracking_code: transportData.tracking_code || '',
      status: 'pending',
      notes: transportData.notes || '',
    })
    .select()
    .single();

  if (shipErr) throw shipErr;

  // Popula o checklist
  await createShipmentChecklist(shipment.id);

  return shipment;
}

/**
 * Reconstrói as capas de cliente de um batch PCP (apenas gestores).
 */
export async function rebuildCustomerCoversForBatch(batchId) {
  if (!batchId) throw new Error('Batch ID é obrigatório.');

  const { error } = await supabase.rpc('create_customer_covers_for_batch', {
    p_batch_id: batchId
  });

  if (error) throw error;
  return { success: true };
}
