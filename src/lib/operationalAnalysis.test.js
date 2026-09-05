import { describe, expect, it } from 'vitest';
import { buildOperationalAnalysis } from './operationalAnalysis';
const row = (cell, produced, target, extra = {}) => ({ date: '2026-08-01', cell, produced, target, scrap: 0, downtime: 0, ...extra });
describe('análise operacional coerente com a produção', () => {
  it('separa chapas, metros e peças e exclui estornos de todos os indicadores', () => {
    const a = buildOperationalAnalysis([row('Corte', 10, 20), row('Bordo', 125.5, 200), row('Embalagem', 100, 100), row('Corte', 900, 900, { approval_status: 'reversed' })]);
    expect(a.units.map((u) => [u.key, u.produced])).toEqual([['sheets', 10], ['meters', 125.5], ['pieces', 100]]);
    expect(a.recordCount).toBe(3);
    expect(a.excludedCount).toBe(1);
    expect(a.insights.find((i) => i.id === 'target-gap').title).toContain('Corte');
  });
  it('não inventa atingimento sem metas nem comparações sem histórico', () => {
    const a = buildOperationalAnalysis([row('Corte', 10, 0), row('Corte', 50, 50)]);
    expect(a.units[0].attainment).toBeNull();
    expect(a.units[0].gap).toBeNull();
    expect(a.insights.some((i) => i.id.startsWith('comparison-'))).toBe(false);
    expect(a.insights.some((i) => i.id === 'missing-target')).toBe(true);
  });
  it('calcula proporções pela base total e atribui a concentração real das paradas', () => {
    const a = buildOperationalAnalysis([row('Usinagem', 90, 100, { scrap: 10, downtime: 90 }), row('Embalagem', 900, 900, { downtime: 30 })], [row('Usinagem', 495, 500)]);
    expect(a.units[0].scrapRate).toBe(1);
    expect(a.insights.find((i) => i.id === 'downtime').evidence).toContain('75%');
    expect(a.insights.find((i) => i.id === 'comparison-pieces').title).toContain('+100%');
  });
  it('trata o vazio como ausência de registros e respeita unidade explícita', () => {
    expect(buildOperationalAnalysis([]).units).toEqual([]);
    expect(buildOperationalAnalysis([row('Corte', 10, 20, { metric_unit: 'pieces' })]).units[0].key).toBe('pieces');
  });
});
