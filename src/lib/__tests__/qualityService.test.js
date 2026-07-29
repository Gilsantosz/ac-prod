import { describe, it, expect } from 'vitest';
import {
  SIX_M_CATEGORIES,
  NC_DISPOSITION_LABELS,
  NC_STATUS_LABELS,
  calculateQualityDashboardMetrics,
} from '../qualityService';

describe('qualityService', () => {
  it('deve contemplar exatamente as 6 categorias de Ishikawa (6M)', () => {
    expect(SIX_M_CATEGORIES).toContain('Máquina');
    expect(SIX_M_CATEGORIES).toContain('Método');
    expect(SIX_M_CATEGORIES).toContain('Material');
    expect(SIX_M_CATEGORIES).toContain('Mão de obra');
    expect(SIX_M_CATEGORIES).toContain('Medição');
    expect(SIX_M_CATEGORIES).toContain('Meio ambiente');
    expect(SIX_M_CATEGORIES.length).toBe(6);
  });

  it('deve mapear todas as disposições técnicas de Não Conformidade', () => {
    expect(NC_DISPOSITION_LABELS.scrap.label).toBe('Refugo');
    expect(NC_DISPOSITION_LABELS.rework.label).toBe('Retrabalho');
    expect(NC_DISPOSITION_LABELS.replacement.label).toBe('Reposição');
    expect(NC_DISPOSITION_LABELS.use_as_is.label).toBe('Uso Como Está');
    expect(NC_DISPOSITION_LABELS.hold.label).toBe('Quarentena / Retido');
  });

  it('deve mapear todos os estados do ciclo de vida de uma NC', () => {
    expect(NC_STATUS_LABELS.open.label).toBe('Aberta');
    expect(NC_STATUS_LABELS.contained.label).toBe('Contida');
    expect(NC_STATUS_LABELS.analysis.label).toBe('Em Análise');
    expect(NC_STATUS_LABELS.closed.label).toBe('Encerrada');
  });

  it('calcula FPY somente com a primeira passagem e ignora leituras bloqueadas ou duplicadas', () => {
    const metrics = calculateQualityDashboardMetrics({
      readings: [
        { id: 'r1', piece_id: 'p1', step_name: 'cut', status: 'rejected', quantity: 1, created_at: '2026-07-29T08:00:00Z' },
        { id: 'r2', piece_id: 'p1', step_name: 'cut', status: 'approved', quantity: 1, created_at: '2026-07-29T09:00:00Z' },
        { id: 'r3', piece_id: 'p2', step_name: 'cut', status: 'approved', quantity: 1, created_at: '2026-07-29T08:30:00Z' },
        { id: 'r4', piece_id: 'p3', step_name: 'cut', status: 'blocked', quantity: 50, created_at: '2026-07-29T08:40:00Z' },
        { id: 'r5', piece_id: 'p3', step_name: 'cut', status: 'duplicated', quantity: 50, created_at: '2026-07-29T08:50:00Z' },
      ],
    });

    expect(metrics.fpy).toBe(50);
    expect(metrics.approvedReadings).toBe(2);
    expect(metrics.rejectedReadings).toBe(1);
    expect(metrics.rejectionRate).toBe(33.3);
  });

  it('consolida Pareto, categoria 6M, criticidade e célula usando a quantidade real', () => {
    const metrics = calculateQualityDashboardMetrics({
      defectCatalog: [
        { id: 'd1', name: 'Erro de medida', six_m_category: 'Medição' },
        { id: 'd2', name: 'Peça riscada', six_m_category: 'Material' },
      ],
      nonconformities: [
        {
          id: 'nc1',
          defect_id: 'd1',
          quantity: 3,
          status: 'open',
          severity: 'critical',
          cell_name: 'Furação',
          created_at: '2026-07-29T08:00:00Z',
        },
        {
          id: 'nc2',
          defect_id: 'd2',
          quantity: 1,
          status: 'closed',
          severity: 'medium',
          cell_name: 'Corte',
          created_at: '2026-07-29T09:00:00Z',
        },
      ],
    });

    expect(metrics.totalNCs).toBe(2);
    expect(metrics.totalDefects).toBe(4);
    expect(metrics.openNCs).toBe(1);
    expect(metrics.closedNCs).toBe(1);
    expect(metrics.criticalNCs).toBe(1);
    expect(metrics.closureRate).toBe(50);
    expect(metrics.paretoData[0]).toMatchObject({ defect: 'Erro de medida', count: 3 });
    expect(metrics.sixMData).toEqual(expect.arrayContaining([
      { name: 'Medição', value: 3 },
      { name: 'Material', value: 1 },
    ]));
    expect(metrics.byCellData[0]).toEqual({ cell: 'Furação', defects: 3 });
  });
});
