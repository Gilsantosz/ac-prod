import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  REPLACEMENT_STATUS_LABELS,
  REPLACEMENT_PRIORITY_LABELS
} from '../replacementService';

describe('replacementService', () => {
  it('deve possuir todos os rótulos e estilos para a máquina de estados técnica', () => {
    expect(REPLACEMENT_STATUS_LABELS.requested).toBeDefined();
    expect(REPLACEMENT_STATUS_LABELS.under_review).toBeDefined();
    expect(REPLACEMENT_STATUS_LABELS.approved).toBeDefined();
    expect(REPLACEMENT_STATUS_LABELS.released).toBeDefined();
    expect(REPLACEMENT_STATUS_LABELS.in_production).toBeDefined();
    expect(REPLACEMENT_STATUS_LABELS.completed).toBeDefined();
    expect(REPLACEMENT_STATUS_LABELS.cancelled).toBeDefined();

    expect(REPLACEMENT_STATUS_LABELS.requested.label).toBe('Solicitada');
    expect(REPLACEMENT_STATUS_LABELS.approved.label).toBe('Aprovada');
    expect(REPLACEMENT_STATUS_LABELS.completed.label).toBe('Concluída');
  });

  it('deve possuir os rótulos de prioridade padronizados', () => {
    expect(REPLACEMENT_PRIORITY_LABELS.normal.label).toBe('Normal');
    expect(REPLACEMENT_PRIORITY_LABELS.high.label).toBe('Alta');
    expect(REPLACEMENT_PRIORITY_LABELS.critical.label).toBe('Crítica');
  });
});
