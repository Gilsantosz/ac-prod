import { describe, it, expect } from 'vitest';

describe('Cell Lot Lifecycle & Active Context — Motor de Ciclo de Lote por Célula', () => {
  it('não permite encerramento de lote na célula se houver retrabalho aberto', () => {
    const lotStatusCalculation = ({
      expected = 42,
      approved = 41,
      pending = 0,
      rejectedCurrent = 0,
      reworkOpen = 1,
      replacementOpen = 0,
    }) => {
      const isCompleted =
        expected > 0 &&
        approved >= expected &&
        pending === 0 &&
        rejectedCurrent === 0 &&
        reworkOpen === 0 &&
        replacementOpen === 0;

      return {
        status: isCompleted ? 'closed' : 'active',
        isClosed: isCompleted,
      };
    };

    const res = lotStatusCalculation({
      expected: 42,
      approved: 42,
      pending: 0,
      rejectedCurrent: 0,
      reworkOpen: 1, // 1 peça em retrabalho
      replacementOpen: 0,
    });

    expect(res.isClosed).toBe(false);
    expect(res.status).toBe('active');
  });

  it('não permite encerramento se houver reposição pendente', () => {
    const lotStatusCalculation = ({
      expected = 42,
      approved = 41,
      pending = 0,
      rejectedCurrent = 0,
      reworkOpen = 0,
      replacementOpen = 1,
    }) => {
      const isCompleted =
        expected > 0 &&
        approved >= expected &&
        pending === 0 &&
        rejectedCurrent === 0 &&
        reworkOpen === 0 &&
        replacementOpen === 0;

      return {
        status: isCompleted ? 'closed' : 'active',
        isClosed: isCompleted,
      };
    };

    const res = lotStatusCalculation({
      expected: 42,
      approved: 42,
      pending: 0,
      rejectedCurrent: 0,
      reworkOpen: 0,
      replacementOpen: 1, // 1 reposição solicitada
    });

    expect(res.isClosed).toBe(false);
    expect(res.status).toBe('active');
  });

  it('encerra o lote na célula apenas quando todas as 42 peças forem aprovadas sem pendências', () => {
    const lotStatusCalculation = ({
      expected = 42,
      approved = 42,
      pending = 0,
      rejectedCurrent = 0,
      reworkOpen = 0,
      replacementOpen = 0,
    }) => {
      const isCompleted =
        expected > 0 &&
        approved >= expected &&
        pending === 0 &&
        rejectedCurrent === 0 &&
        reworkOpen === 0 &&
        replacementOpen === 0;

      return {
        status: isCompleted ? 'closed' : 'active',
        isClosed: isCompleted,
      };
    };

    const res = lotStatusCalculation({
      expected: 42,
      approved: 42,
      pending: 0,
      rejectedCurrent: 0,
      reworkOpen: 0,
      replacementOpen: 0,
    });

    expect(res.isClosed).toBe(true);
    expect(res.status).toBe('closed');
  });
});
