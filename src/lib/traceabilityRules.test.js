import { expect, test } from 'vitest';

import { normalizeTagValue, validateProductionStep } from './traceabilityRules.js';

const route = [
  { id: '1', step_order: 1, step_name: 'Corte', cell_name: 'Seccionadora', required: true },
  { id: '2', step_order: 2, step_name: 'Borda', cell_name: 'Coladeira', required: true },
];

test('normaliza códigos de barras e EPC RFID', () => {
  expect(normalizeTagValue(' 7891234567890\n')).toEqual({
    tagValue: '7891234567890', tagType: 'barcode', tagFormat: 'ean13',
  });
  expect(normalizeTagValue('E28068940000502A1B3C4D5E')).toEqual({
    tagValue: 'E28068940000502A1B3C4D5E', tagType: 'rfid_epc', tagFormat: 'epc96',
  });
});

test('aprova somente a etapa e célula esperadas', () => {
  const result = validateProductionStep({ status: 'in_progress', current_step: 'Corte' }, route, 'Seccionadora');
  expect(result.valid).toBe(true);
  expect(result.next.step_name).toBe('Borda');
});

test('bloqueia peça concluída ou reprovada', () => {
  expect(validateProductionStep({ status: 'completed' }, route, 'Seccionadora').status).toBe('completed');
  expect(validateProductionStep({ status: 'blocked' }, route, 'Seccionadora').status).toBe('blocked');
});

test('rejeita célula, etapa e leitura duplicada', () => {
  const item = { status: 'in_progress', current_step: 'Corte' };
  expect(validateProductionStep(item, route, 'Coladeira').status).toBe('wrong_cell');
  expect(validateProductionStep(item, route, 'Seccionadora', [], 'Borda').status).toBe('wrong_step');
  expect(validateProductionStep(item, route, 'Seccionadora', [
    { step_name: 'Corte', status: 'approved' },
  ]).status).toBe('duplicated');
});

test('exige rota configurada', () => {
  const result = validateProductionStep({ status: 'in_progress' }, [], 'Seccionadora');
  expect(result.status).toBe('route_missing');
});
