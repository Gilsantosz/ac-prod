import { describe, it, expect } from 'vitest';
import {
  SIX_M_CATEGORIES,
  NC_DISPOSITION_LABELS,
  NC_STATUS_LABELS
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
});
