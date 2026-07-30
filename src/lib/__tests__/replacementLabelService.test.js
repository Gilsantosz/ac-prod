import { describe, it, expect } from 'vitest';
import { buildReplacementTraceCode, validateReplacementLabelData } from '@/lib/replacementLabelService';

describe('replacementLabelService — Validações Promob e Rastreabilidade', () => {
  it('constrói o código de rastreio de reposição no padrão oficial [código original]-REP-R[sequência]', () => {
    const origPiece = {
      promob_barcode: '09950020',
      piece_code: 'PÇA-09950020'
    };

    const traceCode = buildReplacementTraceCode(origPiece, 1);
    expect(traceCode).toBe('09950020-REP-R01');

    const traceCode2 = buildReplacementTraceCode(origPiece, 2);
    expect(traceCode2).toBe('09950020-REP-R02');
  });

  it('bloqueia a impressão de etiquetas para reposições não aprovadas (requested ou under_review)', () => {
    const unapprovedOrder = {
      id: 'ord-123',
      status: 'requested',
      replacement_code: 'REP-20260730-7006'
    };

    const val = validateReplacementLabelData(unapprovedOrder);
    expect(val.isValid).toBe(false);
    expect(val.issues.some(i => i.toLowerCase().includes('aprovação'))).toBe(true);
  });

  it('aprova a validação de etiquetas para reposições aprovadas com dados completos', () => {
    const approvedOrder = {
      id: 'ord-456',
      status: 'approved',
      replacement_code: 'REP-20260730-7006',
      lot_code: '26072640',
      order_number: '940002',
      customer_name: 'CLIENTE TESTE AC.PROD',
      original_piece: {
        piece_code: '09950020',
        piece_name: 'TRAVESSA 952,5 × 80 × 15 MM — BRANCO TX',
        general_lot_code: '26072640'
      },
      replacement_piece: {
        traceability_code: '09950020-REP-R01'
      }
    };

    const val = validateReplacementLabelData(approvedOrder);
    expect(val.isValid).toBe(true);
    expect(val.traceCode).toBe('09950020-REP-R01');
    expect(val.generalLot).toBe('26072640');
    expect(val.customerLot).toBe('940002');
  });
});
