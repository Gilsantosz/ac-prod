import { describe, expect, it } from 'vitest';
import { collectionContextMatchesMachine } from '@/lib/collectionContextScope';
import { shouldEnableGlobalProductionRealtime } from '@/lib/realtimeRoutePolicy';

describe('isolamento de contexto da máquina', () => {
  it.each([
    ['machine-1', 'machine-1', true],
    ['machine-1', 'machine-2', false],
    ['machine-1', null, false],
    ['machine-1', undefined, false],
    ['machine-1', '', false],
    [null, null, true],
    [undefined, 'machine-1', true],
    ['', 'machine-1', true],
    [42, '42', true],
  ])('máquina ativa %s / evento %s => %s', (active, incoming, expected) => {
    expect(collectionContextMatchesMachine(active, incoming)).toBe(expected);
  });
});

describe('Realtime global segue o modo efetivo da entrada', () => {
  it.each([
    ['/coleta', '', false],
    ['/coleta/', '', false],
    ['/AC-PROD/COLETA/', '?modo=manual', false],
    ['/coleta-rastreabilidade', '', false],
    ['/coleta-codigo-rfid', '', false],
    ['/entrada', '', false],
    ['/entrada', '?modo=', false],
    ['/entrada', '?ambiente=teste', false],
    ['/entrada', '?modo=coleta', false],
    ['/entrada', '?modo=collection', false],
    ['/entrada', '?modo=%63oleta', false],
    ['/entrada', '?modo=manual', true],
    ['/entrada', '?modo=quick', true],
    ['/entrada', '?modo=complete', true],
    ['/entrada', '?modo=COLETA', true],
    ['/entrada', '?modo=desconhecido', true],
    ['/entrada', '?modo=manual&modo=coleta', true],
    ['/entrada', '?modo=coleta&modo=manual', false],
    ['/entrada?modo=manual', '', true],
    ['/entrada?modo=coleta', '', false],
    ['/entrada?modo=manual#topo', '', true],
    ['/entrada?modo=manual', '?modo=coleta', false],
    ['/ac-prod/entrada/', '?modo=coleta', false],
    ['entrada/', '?modo=manual', true],
    ['/', '', true],
    ['/relatorios', '?modo=coleta', true],
    ['/baixa-manual', '', true],
    ['/reposicao/posto', '', true],
    ['/entrada-manual', '', true],
    ['/quiosque', '', true],
  ])('%s %s => %s', (pathname, search, expected) => {
    expect(shouldEnableGlobalProductionRealtime(pathname, search)).toBe(expected);
  });

  it('troca entre coleta e modo manual sem depender de pathname novo', () => {
    expect(shouldEnableGlobalProductionRealtime('/entrada', '?modo=manual')).toBe(true);
    expect(shouldEnableGlobalProductionRealtime('/entrada', '?modo=coleta')).toBe(false);
    expect(shouldEnableGlobalProductionRealtime('/entrada', '?modo=manual')).toBe(true);
  });
});
