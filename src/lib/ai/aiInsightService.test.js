import { describe, expect, it } from 'vitest';
import { analyzeProductionContext, formatInsightAnswer } from './aiInsightService';

describe('aiInsightService', () => {
  it('calcula indicadores somente a partir dos registros recebidos', () => {
    const analysis = analyzeProductionContext({
      entries: [
        { cell: 'Célula A', produced: 80, target: 100, scrap: 4, downtime: 20 },
        { cell: 'Célula A', produced: 20, target: 20, scrap: 1, downtime: 10 },
      ],
      occurrences: [{ reason: 'Setup', downtime: 45 }],
      lots: [{ status: 'blocked', current_stage: 'cut' }],
    });

    expect(analysis.kpis.produced).toBe(100);
    expect(analysis.kpis.target).toBe(120);
    expect(analysis.kpis.efficiency).toBeCloseTo(83.33, 1);
    expect(analysis.kpis.scrapRate).toBe(5);
    expect(analysis.kpis.downtime).toBe(45);
    expect(analysis.kpis.blockedLots).toBe(1);
    expect(analysis.topReasons[0]).toEqual({ reason: 'Setup', minutes: 45 });
  });

  it('declara ausência de dados sem inventar conclusões', () => {
    const context = {
      entries: [],
      occurrences: [],
      lots: [],
      filters: { startDate: '2026-06-01', endDate: '2026-06-07' },
      warnings: [],
    };
    const analysis = analyzeProductionContext(context);
    const answer = formatInsightAnswer(context, analysis);

    expect(analysis.kpis.produced).toBe(0);
    expect(analysis.insights[0].title).toBe('Sem dados no período');
    expect(answer).toContain('Não encontrei dados produtivos');
  });
});

