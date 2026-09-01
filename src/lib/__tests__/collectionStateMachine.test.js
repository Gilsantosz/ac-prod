import { describe, expect, it } from 'vitest';
import {
  COLLECTION_STATES,
  assertCollectionTransition,
  collectionStateFromResult,
  getCollectionStatePresentation,
  isCollectionApproved,
  isCollectionTerminalState,
} from '@/lib/collectionStateMachine';

describe('collectionStateMachine V3', () => {
  it('expõe todos os estados canônicos exigidos pelo renderer', () => {
    expect(Object.values(COLLECTION_STATES)).toEqual([
      'CAPTURED_LOCAL',
      'PENDING_DATABASE',
      'DATABASE_ACKNOWLEDGED',
      'PROCESSING',
      'APPROVED',
      'REJECTED',
      'BLOCKED',
      'DUPLICATED',
      'PENDING_REVIEW',
      'RETRYING',
      'DEAD_LETTERED',
    ]);
  });

  it('não trata ACK, processamento ou retry como aprovação', () => {
    for (const state of [
      COLLECTION_STATES.CAPTURED_LOCAL,
      COLLECTION_STATES.PENDING_DATABASE,
      COLLECTION_STATES.DATABASE_ACKNOWLEDGED,
      COLLECTION_STATES.PROCESSING,
      COLLECTION_STATES.RETRYING,
    ]) {
      expect(isCollectionApproved(state)).toBe(false);
      expect(getCollectionStatePresentation(state).tone).toBe('neutral');
    }
    expect(isCollectionApproved(COLLECTION_STATES.APPROVED)).toBe(true);
    expect(getCollectionStatePresentation(COLLECTION_STATES.APPROVED).tone)
      .toBe('approved');
  });

  it('normaliza decisões legadas e rejeita regressão terminal', () => {
    expect(collectionStateFromResult({ status: 'duplicated' }))
      .toBe(COLLECTION_STATES.DUPLICATED);
    expect(collectionStateFromResult({ status_sincronizacao: 'recebida' }))
      .toBe(COLLECTION_STATES.DATABASE_ACKNOWLEDGED);
    expect(isCollectionTerminalState(COLLECTION_STATES.PENDING_REVIEW)).toBe(true);
    expect(() => assertCollectionTransition(
      COLLECTION_STATES.APPROVED,
      COLLECTION_STATES.PROCESSING,
    )).toThrow(/Transição de coleta inválida/);
  });
});
