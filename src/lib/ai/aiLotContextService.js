import { supabase } from '@/lib/supabaseClient';
import { fetchGeneralLotTracking } from '@/lib/lotTrackingService';

function cleanLotCode(value) {
  return String(value || '').trim().toUpperCase();
}

function emptyResult(requestedCode = '') {
  return {
    requestedCode,
    matchedAs: null,
    batchId: null,
    generalLotCode: null,
    clientLotCode: null,
    clientLotCodes: [],
    customerName: null,
    tracking: null,
    clientLot: null,
    links: {},
  };
}

async function findGeneralLot(code) {
  if (!code) return null;
  const { data, error } = await supabase
    .from('promob_import_batches')
    .select('id,general_lot_code,file_name,status,total_parts,completed_parts,pending_parts,progress_percent,imported_at')
    .ilike('general_lot_code', code)
    .order('imported_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function findClientLot(code) {
  if (!code) return null;
  const { data, error } = await supabase
    .from('production_lots')
    .select('id,lot_code,customer_name,status,current_stage,progress_percent,pcp_import_batch_id,production_order_id')
    .ilike('lot_code', code)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function fetchBatch(batchId) {
  if (!batchId) return null;
  const { data, error } = await supabase
    .from('promob_import_batches')
    .select('id,general_lot_code,file_name,status,total_parts,completed_parts,pending_parts,progress_percent,imported_at')
    .eq('id', batchId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function buildLinks(generalLotCode, clientLotCode) {
  const query = new URLSearchParams();
  if (generalLotCode) query.set('generalLot', generalLotCode);
  if (clientLotCode) query.set('clientLot', clientLotCode);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return {
    integrity: `/integridade-lote${suffix}`,
    tracking: `/acompanhamento-lotes${suffix}`,
    traceability: `/rastreabilidade${clientLotCode ? `?search=${encodeURIComponent(clientLotCode)}` : ''}`,
  };
}

/**
 * Resolve um código sem assumir previamente se ele é lote geral do PCP ou lote
 * do cliente. Em caso de colisão, o lote geral tem precedência explícita.
 */
export async function resolveAiLotContext(input = {}) {
  const generalRequested = cleanLotCode(input.generalLotCode);
  const clientRequested = cleanLotCode(input.clientLotCode);
  const genericRequested = cleanLotCode(input.lotCode || input.code);
  const requestedCode = generalRequested || clientRequested || genericRequested;
  if (!requestedCode) return emptyResult();

  let batch = generalRequested ? await findGeneralLot(generalRequested) : null;
  let clientLot = clientRequested ? await findClientLot(clientRequested) : null;

  if (!batch && !clientLot && genericRequested) {
    batch = await findGeneralLot(genericRequested);
    if (!batch) clientLot = await findClientLot(genericRequested);
  }

  if (!batch && clientLot?.pcp_import_batch_id) {
    batch = await fetchBatch(clientLot.pcp_import_batch_id);
  }

  const batchId = batch?.id || clientLot?.pcp_import_batch_id || null;
  let tracking = null;
  if (batchId) {
    try {
      tracking = await fetchGeneralLotTracking({ batchId, limit: 1 });
    } catch {
      // A busca básica continua útil durante uma implantação parcial da RPC.
    }
  }

  const generalLot = tracking?.general_lots?.[0] || null;
  if (!clientLot && clientRequested && generalLot) {
    clientLot = generalLot.client_lots?.find((lot) =>
      cleanLotCode(lot.lot_code) === clientRequested
    ) || null;
  }

  const generalLotCode = cleanLotCode(
    generalLot?.general_lot_code || batch?.general_lot_code
  ) || null;
  const clientLotCode = cleanLotCode(clientLot?.lot_code) || null;
  const clientLotCodes = [
    ...new Set(
      (generalLot?.client_lots || [])
        .map((lot) => cleanLotCode(lot.lot_code))
        .filter(Boolean)
    ),
  ];

  return {
    requestedCode,
    matchedAs: batch && (!clientLot || generalRequested || genericRequested === generalLotCode)
      ? 'general'
      : (clientLot ? 'client' : null),
    batchId,
    generalLotCode,
    clientLotCode,
    clientLotCodes: clientLotCodes.length
      ? clientLotCodes
      : (clientLotCode ? [clientLotCode] : []),
    customerName: clientLot?.customer_name || null,
    batch,
    tracking,
    generalLot,
    clientLot,
    links: buildLinks(generalLotCode, clientLotCode),
  };
}

