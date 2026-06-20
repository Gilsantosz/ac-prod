import { expect, test } from 'vitest';
import {
  buildInsightsAnswer,
  buildLotAnswer,
  classifyAssistantIntent,
  extractLotSearch,
  findNavigationTopic,
} from './assistantEngine.js';

test('identifica código de lote e mantém o contexto na pergunta seguinte', () => {
  expect(extractLotSearch('Qual a situação do lote LOTE-LM-123-001?')).toBe('LOTE-LM-123-001');
  expect(
    classifyAssistantIntent('ele já foi embalado?', { lastLotCode: 'LOTE-LM-123-001' }),
  ).toBe('lot');
});

test('reconhece os atalhos de insights e sugestões produtivas', () => {
  expect(classifyAssistantIntent('Insights produtivos')).toBe('insights');
  expect(classifyAssistantIntent('Me dê sugestões para melhorar a produção')).toBe('insights');
  expect(classifyAssistantIntent('O que é rastreabilidade de lote?')).toBe('knowledge');
});

test('indica somente telas permitidas ao usuário', () => {
  const operator = { role: 'operator', permissions: { register_production: true } };
  expect(findNavigationTopic('onde registro produção?', operator)?.path).toBe('/entrada');
  expect(findNavigationTopic('quero gerenciar usuários', operator)).toBeNull();
});

test('resume rota, embalagem, expedição e encerramento de um lote', () => {
  const answer = buildLotAnswer({
    lot: {
      lot_code: 'LOTE-001',
      status: 'in_progress',
      current_stage: 'cnc',
      progress_percent: 45,
      missing_count: 0,
      rework_count: 1,
      scrap_count: 0,
      production_orders: { order_code: 'PED-10', customer_name: 'Cliente', delivery_date: '2099-01-01' },
      lot_items: [{ quantity: 4, requires_cut: true, requires_edge: true, requires_cnc: true, requires_joinery: false, requires_separation: true, requires_packaging: true, requires_shipping: true }],
    },
    events: [
      { step_code: 'cut', event_type: 'finish', created_at: '2026-06-17T10:00:00Z' },
      { step_code: 'cnc', event_type: 'start', created_at: '2026-06-17T11:00:00Z' },
    ],
    packages: [{ status: 'closed' }],
    shipments: [{ status: 'pending', shipment_code: 'EXP-1' }],
  });

  expect(answer).toMatch(/Etapa atual: Usinagem/);
  expect(answer).toMatch(/Ainda falta passar por: Separação → Embalagem/);
  expect(answer).toMatch(/Embalagem: 1\/1 volume/);
  expect(answer).toMatch(/Expedição: pendente/);
  expect(answer).toMatch(/lote ainda aberto/);
});

test('gera insights objetivos a partir dos indicadores', () => {
  const answer = buildInsightsAnswer({
    periodStart: '2026-06-11',
    periodEnd: '2026-06-17',
    entries: [
      { cell: 'Corte', produced: 70, target: 100, scrap: 5, downtime: 30 },
      { cell: 'Bordo', produced: 95, target: 100, scrap: 0, downtime: 5 },
    ],
    occurrences: [{ reason: 'Setup', downtime: 30 }],
    lots: [{ status: 'blocked', current_stage: 'cut', production_orders: {} }],
  });

  expect(answer).toMatch(/Eficiência:/);
  expect(answer).toMatch(/Priorize a célula Corte/);
  expect(answer).toMatch(/Setup/);
  expect(answer).toMatch(/1 lote\(s\) bloqueado\(s\)/);
});
