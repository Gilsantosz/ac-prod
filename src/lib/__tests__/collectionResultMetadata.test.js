import { describe, expect, it } from 'vitest';
import { enrichCollectionResult } from '@/lib/collectionResultMetadata';

describe('enriquecimento da mesma decisão de coleta', () => {
  it('completa objetos parciais e valores ausentes, preservando decisão, autoria, zero e false', () => {
    const previous = { decision: 'approved', success: true, operator_id: 'original',
      item: { id: 'piece-1', piece_uid: '', route_steps: [] },
      lot: { id: 'lot-1', lot_code: null, progress_percent: 0, completed: false } };
    const incoming = { decision: 'blocked', success: false, operator_id: 'other',
      item: { id: 'other', piece_uid: '09890703', route_steps: ['cut', 'edge'] },
      lot: { lot_code: '947001', general_lot_code: 'TESTECOLETA20260907', progress_percent: 50, completed: true } };
    const result = enrichCollectionResult(previous, incoming);
    expect(result).toMatchObject({ decision: 'approved', success: true, operator_id: 'original',
      item: { id: 'piece-1', piece_uid: '09890703', route_steps: ['cut', 'edge'] },
      lot: { lot_code: '947001', general_lot_code: 'TESTECOLETA20260907', progress_percent: 0, completed: false } });
    expect(previous.item.piece_uid).toBe('');
    expect(enrichCollectionResult(result, incoming)).toBe(result);
    expect(enrichCollectionResult(result, { item: null, lot: {} })).toBe(result);
  });
});
