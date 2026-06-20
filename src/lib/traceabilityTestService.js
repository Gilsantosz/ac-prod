import { base44 } from '@/lib/localDb';
import { supabase } from '@/lib/supabaseClient';
import { processProductionReading } from '@/lib/traceabilityService';

const TEST_ROUTE = [
  { id: 'test-route-cut', step_order: 1, step_name: 'Corte', cell_name: 'Célula A', required: true, code: 'cut' },
  { id: 'test-route-edge', step_order: 2, step_name: 'Bordo', cell_name: 'Célula B', required: true, code: 'edge' },
  { id: 'test-route-cnc', step_order: 3, step_name: 'Usinagem', cell_name: 'Célula C', required: true, code: 'cnc' },
];

const isMissingSchema = (error) => Boolean(error && (
  ['PGRST202', 'PGRST204', 'PGRST205', '42P01', '42703'].includes(error.code)
  || /schema cache|could not find|does not exist/i.test(error.message || '')
));

function testTagsForItem(item) {
  const suffix = String(item.item_code || item.serial_code || item.id).replace(/^PECA-TEST-/, '');
  return [
    { id: `barcode-${item.id}`, item_id: item.id, tag_value: `BARCODE-TEST-${suffix}`, tag_type: 'barcode', tag_format: 'custom' },
    { id: `qrcode-${item.id}`, item_id: item.id, tag_value: `QRCODE-TEST-${suffix}`, tag_type: 'qrcode', tag_format: 'qrcode' },
    { id: `rfid-${item.id}`, item_id: item.id, tag_value: `RFID-TEST-${suffix}`, tag_type: 'rfid_epc', tag_format: 'epc96' },
  ];
}

function normalizeLegacyItem(piece, sourceItem) {
  const route = TEST_ROUTE.find((step) => step.code === piece.current_stage) || TEST_ROUTE[0];
  return {
    ...piece,
    item_code: sourceItem?.piece_code || piece.serial_code,
    product_name: sourceItem?.piece_name || 'Peça de Teste',
    current_step: piece.status === 'completed' ? 'Concluída' : route.step_name,
    current_cell: piece.status === 'completed' ? null : route.cell_name,
    source_lot_item_id: piece.lot_item_id,
    _stageCode: route.code,
    _legacy: true,
  };
}

export async function fetchTraceabilityTestDetails(lotId) {
  if (!lotId) return { items: [], routes: [], tags: [], mode: 'legacy' };

  const [modernItems, modernRoutes, modernTags] = await Promise.all([
    supabase.from('production_lot_items').select('*').eq('lot_id', lotId),
    supabase.from('production_routes').select('*').eq('lot_id', lotId).order('step_order'),
    supabase.from('production_tags').select('*').eq('lot_id', lotId),
  ]);

  const modernAvailable = !modernItems.error && !modernRoutes.error && !modernTags.error;
  if (modernAvailable && modernItems.data?.length) {
    return {
      items: modernItems.data || [],
      routes: modernRoutes.data || [],
      tags: modernTags.data || [],
      mode: 'collection',
    };
  }

  const unexpected = [modernItems.error, modernRoutes.error, modernTags.error]
    .find((error) => error && !isMissingSchema(error));
  if (unexpected) throw unexpected;

  const [piecesResult, sourceItemsResult] = await Promise.all([
    supabase.from('piece_instances').select('*').eq('lot_id', lotId).order('created_at'),
    supabase.from('lot_items').select('*').eq('lot_id', lotId).order('created_at'),
  ]);
  if (piecesResult.error) throw piecesResult.error;
  if (sourceItemsResult.error) throw sourceItemsResult.error;

  const sourceItems = sourceItemsResult.data || [];
  const items = (piecesResult.data || []).map((piece) => normalizeLegacyItem(
    piece,
    sourceItems.find((source) => source.id === piece.lot_item_id),
  ));

  if (!items.length && modernAvailable) {
    return {
      items: modernItems.data || [],
      routes: modernRoutes.data || [],
      tags: modernTags.data || [],
      mode: 'collection',
    };
  }

  return {
    items,
    routes: TEST_ROUTE,
    tags: items.flatMap(testTagsForItem),
    mode: 'legacy',
  };
}

async function supportsCollectionSchema() {
  const { error } = await supabase.from('production_lot_items').select('id').limit(1);
  if (error) return false;
  const rpcProbe = await supabase.rpc('process_production_reading', { p_payload: {} });
  return !rpcProbe.error;
}

export async function generateTraceabilityTestLot(randomId) {
  let order = null;
  let lot = null;
  const mode = await supportsCollectionSchema() ? 'collection' : 'legacy';

  try {
    order = await base44.entities.ProductionOrder.create({
      order_code: `ORDEM-TEST-${randomId}`,
      customer_name: 'Cliente Simulado (Teste Coletas)',
      source: 'manual',
      status: 'released',
    });

    lot = await base44.entities.ProductionLot.create({
      order_id: order.id,
      lot_code: `LOTE-TEST-${randomId}`,
      status: 'released',
      current_stage: 'cut',
    });

    if (mode === 'collection') {
      await Promise.all(TEST_ROUTE.map((route) => base44.entities.ProductionRoute.create({
        lot_id: lot.id,
        step_order: route.step_order,
        step_name: route.step_name,
        cell_name: route.cell_name,
        required: true,
      })));

      const items = await Promise.all([1, 2].map((sequence) => base44.entities.ProductionLotItem.create({
        lot_id: lot.id,
        item_code: `PECA-TEST-${randomId}-${String(sequence).padStart(2, '0')}`,
        product_name: sequence === 1 ? 'Painel MDF Teste Celular' : 'Painel MDF Teste RFID',
        current_step: 'Corte',
        current_cell: 'Célula A',
        status: 'pending',
      })));

      await Promise.all(items.flatMap((item) => testTagsForItem(item).map((tag) => (
        base44.entities.ProductionTag.create({ ...tag, lot_id: lot.id, active: true })
      ))));
    } else {
      const sourceItems = await Promise.all([1, 2].map((sequence) => base44.entities.LotItem.create({
        lot_id: lot.id,
        piece_code: `PECA-TEST-${randomId}-${String(sequence).padStart(2, '0')}`,
        piece_name: sequence === 1 ? 'Painel MDF Teste Celular' : 'Painel MDF Teste RFID',
        material: 'MDF Teste',
        quantity: 1,
        requires_cut: true,
        requires_edge: true,
        requires_cnc: true,
        requires_separation: false,
        requires_packaging: false,
        requires_shipping: false,
        status: 'pending',
      })));

      await Promise.all(sourceItems.map((sourceItem, index) => base44.entities.PieceInstance.create({
        lot_item_id: sourceItem.id,
        lot_id: lot.id,
        serial_code: `BARCODE-TEST-${randomId}-${String(index + 1).padStart(2, '0')}`,
        qr_code: `QRCODE-TEST-${randomId}-${String(index + 1).padStart(2, '0')}`,
        current_stage: 'cut',
        status: 'pending',
      })));
    }

    return { lot, order, mode };
  } catch (error) {
    if (lot?.id) await supabase.from('production_lots').delete().eq('id', lot.id);
    if (order?.id) await supabase.from('production_orders').delete().eq('id', order.id);
    throw error;
  }
}

function normalizeTestReading(event) {
  const tagValue = String(event.notes || '').match(/(?:BARCODE|QRCODE|RFID)-TEST-[A-Z0-9-]+/)?.[0] || 'TAG-TESTE';
  const createdAt = new Date(event.created_at);
  return {
    id: event.id,
    tag_value: tagValue,
    reader_type: event.device_id || 'legacy_simulator',
    cell_name: event.cell,
    step_name: TEST_ROUTE.find((step) => step.code === event.step_code)?.step_name || event.step_code,
    status: event.event_type === 'finish' ? 'approved' : 'blocked',
    hour: Number.isNaN(createdAt.getTime()) ? '' : createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    created_at: event.created_at,
  };
}

export async function fetchTraceabilityTestReadings() {
  const modern = await supabase
    .from('production_stage_readings')
    .select('*')
    .or('tag_value.ilike.BARCODE-TEST-%,tag_value.ilike.QRCODE-TEST-%,tag_value.ilike.RFID-TEST-%')
    .order('created_at', { ascending: false })
    .limit(15);
  if (!modern.error) return modern.data || [];
  if (!isMissingSchema(modern.error)) throw modern.error;

  const legacy = await supabase
    .from('lot_step_events')
    .select('*')
    .ilike('notes', '%-TEST-%')
    .order('created_at', { ascending: false })
    .limit(15);
  if (legacy.error) throw legacy.error;
  return (legacy.data || []).map(normalizeTestReading);
}

export async function fetchTraceabilityTestLogs() {
  const modern = await supabase
    .from('traceability_logs')
    .select('*')
    .or('details->>tag.ilike.BARCODE-TEST-%,details->>tag.ilike.QRCODE-TEST-%,details->>tag.ilike.RFID-TEST-%')
    .order('created_at', { ascending: false })
    .limit(10);
  if (!modern.error) return modern.data || [];
  if (!isMissingSchema(modern.error)) throw modern.error;

  const legacy = await supabase
    .from('lot_step_events')
    .select('*')
    .ilike('notes', '%-TEST-%')
    .order('created_at', { ascending: false })
    .limit(10);
  if (legacy.error) throw legacy.error;
  return (legacy.data || []).map((event) => ({
    id: event.id,
    action: event.event_type === 'finish' ? 'approved_scan' : event.event_type,
    entity: 'piece_instance',
    entity_id: event.piece_instance_id,
    details: { tag: normalizeTestReading(event).tag_value, step: event.step_code, cell: event.cell },
  }));
}

async function simulateLegacyReading({ item, lot, tagValue, readerType, cellName, stepName, operator, shift }) {
  const expected = TEST_ROUTE.find((step) => step.code === item._stageCode) || TEST_ROUTE[0];
  const requested = TEST_ROUTE.find((step) => step.step_name === stepName) || expected;
  if (item.status === 'completed') {
    return { success: false, status: 'completed', message: 'A peça já concluiu a rota produtiva.', lot, item };
  }

  const duplicate = await supabase
    .from('lot_step_events')
    .select('id')
    .eq('piece_instance_id', item.id)
    .eq('step_code', requested.code)
    .eq('event_type', 'finish')
    .limit(1);
  if (duplicate.error) throw duplicate.error;
  if (duplicate.data?.length) {
    return { success: false, status: 'duplicated', message: 'Esta peça já foi baixada nesta etapa.', lot, item, route: requested };
  }

  if (stepName !== expected.step_name) {
    return { success: false, status: 'wrong_step', message: `Etapa esperada: ${expected.step_name}.`, lot, item, route: expected };
  }
  if (cellName !== expected.cell_name) {
    return { success: false, status: 'wrong_cell', message: `Célula esperada: ${expected.cell_name}.`, lot, item, route: expected };
  }

  const event = await base44.entities.LotStepEvent.create({
    lot_id: lot.id,
    lot_item_id: item.source_lot_item_id,
    piece_instance_id: item.id,
    step_code: expected.code,
    event_type: 'finish',
    quantity: 1,
    cell: cellName,
    notes: `Coleta de teste - ${tagValue} - ${readerType}`,
    device_id: readerType,
  });

  const routeIndex = TEST_ROUTE.findIndex((step) => step.code === expected.code);
  const nextStep = TEST_ROUTE[routeIndex + 1] || null;
  await base44.entities.PieceInstance.update(item.id, {
    current_stage: nextStep?.code || expected.code,
    status: nextStep ? 'in_progress' : 'completed',
  });

  const now = new Date();
  await base44.entities.ProductionEntry.create({
    date: now.toISOString().slice(0, 10),
    shift: shift || '1º Turno',
    cell: cellName,
    hour: now.toTimeString().slice(0, 5),
    produced: 1,
    target: 0,
    scrap: 0,
    downtime: 0,
    operator,
    notes: `Coleta produtiva - tag ${tagValue} | ${lot.lot_code} | ${item.item_code}`,
  });

  const pieces = await base44.entities.PieceInstance.filter({ lot_id: lot.id });
  const completedUnits = pieces.reduce((total, piece) => {
    if (piece.status === 'completed') return total + TEST_ROUTE.length;
    const stageIndex = TEST_ROUTE.findIndex((step) => step.code === piece.current_stage);
    return total + Math.max(0, stageIndex);
  }, 0);
  const progress = pieces.length
    ? Math.round((completedUnits / (pieces.length * TEST_ROUTE.length)) * 100)
    : 0;
  const allCompleted = pieces.length > 0 && pieces.every((piece) => piece.status === 'completed');
  const earliestStage = pieces
    .filter((piece) => piece.status !== 'completed')
    .map((piece) => TEST_ROUTE.find((step) => step.code === piece.current_stage))
    .filter(Boolean)
    .sort((a, b) => a.step_order - b.step_order)[0];
  await base44.entities.ProductionLot.update(lot.id, {
    current_stage: allCompleted ? 'completed' : earliestStage?.code || expected.code,
    status: allCompleted ? 'shipped' : 'in_progress',
    progress_percent: progress,
    actual_end: allCompleted ? now.toISOString() : null,
  });

  return {
    success: true,
    status: 'approved',
    message: nextStep ? `Leitura aprovada. Próxima etapa: ${nextStep.step_name}.` : 'Leitura aprovada. Peça concluída.',
    lot: { ...lot, progress_percent: progress },
    item: { ...item, current_step: nextStep?.step_name || 'Concluída', current_cell: nextStep?.cell_name || null, status: nextStep ? 'in_progress' : 'completed' },
    route: expected,
    reading: normalizeTestReading(event),
    nextStep,
  };
}

export async function simulateTraceabilityTestReading(payload) {
  if (payload.mode === 'legacy' || payload.item?._legacy) return simulateLegacyReading(payload);
  return processProductionReading({
    rawValue: payload.tagValue,
    readerType: payload.readerType,
    readerName: payload.readerType.startsWith('rfid') ? 'Leitor RFID Simulado' : 'Câmera Celular Simulada',
    cellName: payload.cellName,
    stepName: payload.stepName,
    operator: payload.operator,
    shift: payload.shift,
  });
}

export async function deleteTraceabilityTestData() {
  const rpcResult = await supabase.rpc('delete_traceability_test_data');
  if (!rpcResult.error) return rpcResult.data;
  if (!isMissingSchema(rpcResult.error)) throw rpcResult.error;

  const [lotsResult, ordersResult] = await Promise.all([
    supabase.from('production_lots').select('id').like('lot_code', 'LOTE-TEST-%'),
    supabase.from('production_orders').select('id').like('order_code', 'ORDEM-TEST-%'),
  ]);
  if (lotsResult.error) throw lotsResult.error;
  if (ordersResult.error) throw ordersResult.error;

  const lots = lotsResult.data || [];
  const orders = ordersResult.data || [];
  const entriesResult = await supabase
    .from('production_entries')
    .delete()
    .or('notes.ilike.%BARCODE-TEST-%,notes.ilike.%QRCODE-TEST-%,notes.ilike.%RFID-TEST-%,notes.ilike.%LOTE-TEST-%,notes.ilike.%PECA-TEST-%');
  if (entriesResult.error) throw entriesResult.error;

  if (lots.length) {
    const lotDelete = await supabase.from('production_lots').delete().in('id', lots.map((lot) => lot.id));
    if (lotDelete.error) throw lotDelete.error;
  }
  if (orders.length) {
    const orderDelete = await supabase.from('production_orders').delete().in('id', orders.map((order) => order.id));
    if (orderDelete.error) throw orderDelete.error;
  }

  return {
    success: true,
    deleted_readings: 0,
    deleted_entries: 0,
    deleted_lots: lots.length,
    deleted_orders: orders.length,
  };
}

export { TEST_ROUTE };
