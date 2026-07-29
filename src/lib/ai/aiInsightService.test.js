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

  it('faz análise de qualidade com Pareto, ações vencidas e recomendação', () => {
    const context = {
      entries: [{ date: '2026-07-28', produced: 100, target: 100, scrap: 5, cell: 'Corte' }],
      occurrences: [],
      lots: [],
      qualityNonconformities: [
        { created_at: '2026-07-27', defect_name: 'Erro de medida', quantity: 2, status: 'open', severity: 'high', cell_name: 'Corte' },
        { created_at: '2026-07-28', defect_name: 'Erro de medida', quantity: 1, status: 'closed', severity: 'medium', cell_name: 'Corte' },
      ],
      qualityActions: [
        { status: 'open', when_deadline: '2026-01-01T00:00:00Z' },
      ],
      filters: { startDate: '2026-07-27', endDate: '2026-07-28' },
      warnings: [],
    };
    const analysis = analyzeProductionContext(context);
    const answer = formatInsightAnswer(context, analysis, { focus: 'quality' });

    expect(analysis.kpis.openNonconformities).toBe(1);
    expect(analysis.kpis.overdueQualityActions).toBe(1);
    expect(analysis.quality.topDefects[0]).toEqual({ label: 'Erro de medida', quantity: 3 });
    expect(answer).toContain('Pareto principal');
    expect(answer).toContain('Ações sugeridas');
  });

  it('rotula projeções como estimativa e informa confiança', () => {
    const context = {
      entries: [
        { date: '2026-07-20', produced: 100, target: 100, scrap: 1 },
        { date: '2026-07-28', produced: 70, target: 100, scrap: 5 },
      ],
      occurrences: [],
      lots: [],
      qualityNonconformities: [],
      qualityActions: [],
      filters: { startDate: '2026-07-20', endDate: '2026-07-28' },
      warnings: [],
    };
    const analysis = analyzeProductionContext(context);
    const answer = formatInsightAnswer(context, analysis, { focus: 'predictive' });

    expect(analysis.prediction.risk).toBe('elevado');
    expect(answer).toContain('estimativa operacional');
    expect(answer).toContain('confiança');
  });
});
