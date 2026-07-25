import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  REPLACEMENT_STATUS_LABELS,
  REPLACEMENT_PRIORITY_LABELS,
  enrichReplacementOrderData
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

  it('deve preservar o rastreio real e nunca fabricar código a partir da ordem de reposição', () => {
    const order = enrichReplacementOrderData({
      id: '53da3b4d-cb26-4101-8b9e-9ffd5636a326',
      original_piece_id: '15b586a8-1c0b-4eed-9ac3-15ce95982a07',
      replacement_code: 'REP-20260725-6499',
      rejection_stage: 'Concluída',
      lot_code: '143352',
      order_number: '143352',
      customer_name: 'PAROQUIA SAO JUDAS TADEU',
      original_piece: {
        id: '15b586a8-1c0b-4eed-9ac3-15ce95982a07',
        piece_uid: '09907352',
        traceability_code: '09907352',
        current_stage: 'Concluída',
        lot_code: '143352',
        route_steps: ['cut', 'edge', 'separation', 'packaging']
      }
    });

    expect(order.original_piece.piece_uid).toBe('09907352');
    expect(order.original_piece.traceability_code).toBe('09907352');
    expect(order.original_piece.piece_uid).not.toContain('REP-20260725-6499');
    expect(order.resolved_client_lot).toBe('143352');
    expect(order.order_number).toBe('143352');
  });

});
