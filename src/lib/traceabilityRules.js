export function normalizeTagValue(rawValue) {
  const original = String(rawValue ?? '').trim();
  if (!original) return { tagValue: '', tagType: 'manual', tagFormat: 'custom' };

  const compact = original.replace(/[\r\n\t]/g, '').trim();
  const upper = compact.toUpperCase();

  if (/^\]D2/.test(upper) || /^(01|10|21)\d{8,}/.test(upper)) {
    return { tagValue: upper, tagType: 'datamatrix', tagFormat: 'datamatrix' };
  }
  if (/^[A-F0-9]{24}$/.test(upper) || /^EPC[-:_]/.test(upper)) {
    return { tagValue: upper.replace(/\s+/g, ''), tagType: 'rfid_epc', tagFormat: /^[A-F0-9]{24}$/.test(upper) ? 'epc96' : 'epc_custom' };
  }
  if (/^https?:\/\//i.test(compact) || /^[{[]/.test(compact) || /^QR[:_-]/i.test(compact)) {
    return { tagValue: upper, tagType: 'qrcode', tagFormat: 'qrcode' };
  }
  if (/^\d{13}$/.test(upper)) {
    return { tagValue: upper, tagType: 'barcode', tagFormat: 'ean13' };
  }
  return { tagValue: upper.replace(/\s+/g, ''), tagType: 'barcode', tagFormat: 'custom' };
}

export function validateProductionStep(itemOrPayload, route = [], currentCell, approvedReadings = [], requestedStep = null) {
  const payloadStyle = arguments.length === 1 && itemOrPayload && Object.hasOwn(itemOrPayload, 'item');
  const item = payloadStyle ? itemOrPayload.item : itemOrPayload;
  if (payloadStyle) {
    route = itemOrPayload.route || [];
    currentCell = itemOrPayload.cellName || itemOrPayload.currentCell;
    approvedReadings = itemOrPayload.approvedReadings || itemOrPayload.readings || [];
    requestedStep = itemOrPayload.requestedStep || itemOrPayload.stepName || null;
  }

  if (!item) return { valid: false, status: 'not_found', message: 'Peça não localizada.' };
  if (['rejected', 'blocked', 'scrap', 'cancelled'].includes(item.status)) {
    return { valid: false, status: 'blocked', message: 'Peça bloqueada ou reprovada.' };
  }
  if (item.status === 'completed') {
    return { valid: false, status: 'completed', message: 'A peça já concluiu a rota produtiva.' };
  }

  const ordered = [...route].filter((step) => step.required !== false).sort((a, b) => a.step_order - b.step_order);
  const expected = ordered.find((step) => step.step_name === item.current_step) || ordered[0];
  if (!expected) return { valid: false, status: 'route_missing', message: 'Rota produtiva não configurada.' };

  if (requestedStep && requestedStep !== expected.step_name) {
    return { valid: false, status: 'wrong_step', message: `Etapa esperada: ${expected.step_name}.`, expected };
  }
  if (expected.cell_name && currentCell && expected.cell_name.toLowerCase() !== currentCell.toLowerCase()) {
    return { valid: false, status: 'wrong_cell', message: `Célula esperada: ${expected.cell_name}.`, expected };
  }
  if (approvedReadings.some((reading) => reading.step_name === expected.step_name && reading.status === 'approved')) {
    return { valid: false, status: 'duplicated', message: 'Esta peça já foi baixada nesta etapa.', expected };
  }

  const index = ordered.findIndex((step) => step.id === expected.id || step.step_name === expected.step_name);
  const previousRequired = index > 0 ? ordered[index - 1] : null;
  if (previousRequired && item.current_step !== expected.step_name) {
    const previousDone = approvedReadings.some((reading) => reading.step_name === previousRequired.step_name && reading.status === 'approved');
    if (!previousDone) return { valid: false, status: 'wrong_step', message: `Conclua primeiro: ${previousRequired.step_name}.`, expected };
  }

  return { valid: true, status: 'approved', message: 'Etapa e célula validadas.', expected, next: ordered[index + 1] || null };
}
