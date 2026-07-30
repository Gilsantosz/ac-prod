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

  it('permite a impressão de etiquetas para reposições abertas/solicitadas para identificação opcional', () => {
    const requestedOrder = {
      id: 'ord-123',
      status: 'requested',
      replacement_code: 'REP-20260730-7006',
      lot_code: '26072640',
      order_number: '940002',
      original_piece: {
        piece_code: '09950020',
        piece_name: 'TRAVESSA 952,5 × 80 × 15 MM — BRANCO TX'
      }
    };

    const val = validateReplacementLabelData(requestedOrder);
    expect(val.isValid).toBe(true);
  });

  it('bloqueia a impressão de etiquetas APENAS para reposições canceladas', () => {
    const cancelledOrder = {
      id: 'ord-999',
      status: 'cancelled',
      replacement_code: 'REP-20260730-9999'
    };

    const val = validateReplacementLabelData(cancelledOrder);
    expect(val.isValid).toBe(false);
    expect(val.issues.some(i => i.toLowerCase().includes('cancelada'))).toBe(true);
  });
});
