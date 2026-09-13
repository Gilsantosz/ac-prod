import { describe, expect, it } from 'vitest';
import { shouldEnableGlobalProductionRealtime } from './realtimeRoutePolicy';

describe('política de Realtime por rota', () => {
  it.each([
    '/coleta',
    '/coleta/',
    '/Coleta',
    '/ac-prod/coleta',
    '/ac-prod/coleta/',
    '/AC-PROD/COLETA',
  ])('desliga o canal global na estação de coleta: %s', (pathname) => {
    expect(shouldEnableGlobalProductionRealtime(pathname)).toBe(false);
  });

  it.each([
    '/',
    '/painel',
    '/reposicao',
    '/reposicao/posto',
    '/coleta-codigo-rfid',
  ])('mantém o canal global nas demais rotas: %s', (pathname) => {
    expect(shouldEnableGlobalProductionRealtime(pathname)).toBe(true);
  });
});
