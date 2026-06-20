import { describe, expect, it } from 'vitest';
import { buildProductionFilters, parseProductionQuestion } from './aiProductionSearchService';

describe('aiProductionSearchService', () => {
  it.each([
    ['Mostre todos os pedidos da carga 15479.', 'load', '15479'],
    ['Gere relatório do pedido 142355.', 'order', '142355'],
    ['Qual pedido está no pallet 10802?', 'pallet', '10802'],
  ])('interpreta %s', (prompt, key, expected) => {
    const intent = parseProductionQuestion(prompt);
    expect(intent[key]).toBe(expected);
  });

  it('converte finalização e etapa em filtros produtivos', () => {
    const intent = parseProductionQuestion('Quais produtos finalizam em 06-jul-26 e estão na Marcenaria?');
    const filters = buildProductionFilters(intent);
    expect(filters.finalizationDate).toBe('2026-07-06');
    expect(filters.stage).toBe('joinery');
  });
});

