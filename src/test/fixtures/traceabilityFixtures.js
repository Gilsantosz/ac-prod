const steps = [
  ['route-cut', 1, 'Corte', 'Corte'],
  ['route-joinery', 2, 'Marcenaria', 'Marcenaria'],
  ['route-assembly', 3, 'Montagem', 'Montagem'],
  ['route-quality', 4, 'Qualidade', 'Qualidade'],
  ['route-shipping', 5, 'Expedição', 'Expedição'],
];

export const productionOrderFixture = {
  id: 'order-test-001',
  order_code: 'OP-TEST-001',
  product_name: 'Porta Pivotante Teste',
  customer_name: 'Cliente Teste',
  planned_quantity: 10,
};

export const productionLotFixture = {
  id: 'lot-test-001',
  lot_code: 'LSM-TEST-001',
  production_order_id: productionOrderFixture.id,
  product_name: productionOrderFixture.product_name,
  planned_quantity: 10,
  current_stage: 'Corte',
  status: 'in_progress',
  production_orders: productionOrderFixture,
};

export const productionRouteFixture = steps.map(([id, stepOrder, stepName, cellName]) => ({
  id,
  lot_id: productionLotFixture.id,
  step_order: stepOrder,
  step_name: stepName,
  cell_name: cellName,
  required: true,
}));

export const productionItemsFixture = Array.from({ length: 10 }, (_, index) => {
  const sequence = String(index + 1).padStart(3, '0');
  return {
    id: `item-${sequence}`,
    lot_id: productionLotFixture.id,
    piece_code: `P${sequence}`,
    piece_name: `Porta Pivotante Teste P${sequence}`,
    quantity: 1,
    status: 'in_progress',
    current_step: 'Corte',
    barcode: `LSM-TEST-001-P${sequence}`,
    qrCode: `QR:LSM-TEST-001-P${sequence}`,
    rfidEpc: `EPC-TEST-${String(index + 1).padStart(12, '0')}`,
  };
});

export const traceabilityTagsFixture = productionItemsFixture.flatMap((item) => [
  { id: `tag-barcode-${item.piece_code}`, item_id: item.id, tag_value: item.barcode, tag_type: 'barcode' },
  { id: `tag-qr-${item.piece_code}`, item_id: item.id, tag_value: item.qrCode, tag_type: 'qrcode' },
  { id: `tag-rfid-${item.piece_code}`, item_id: item.id, tag_value: item.rfidEpc, tag_type: 'rfid_epc' },
]);

export const validReadingFixture = {
  rawValue: productionItemsFixture[0].barcode,
  readerType: 'keyboard_barcode',
  readerId: 'SCANNER-TEST-01',
  stationName: 'Posto Corte 01',
  cellName: 'Corte',
  operator: 'Operador Teste',
  shift: '1º Turno',
  date: '2026-06-19',
  hour: '08:00',
  mode: 'scanner',
};
