import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('authentication and PWA continuity contracts', () => {
  it('does not revoke the operational session when CollectionPage unmounts', () => {
    const source = read('src/pages/CollectionPage.jsx');
    expect(source).not.toContain('return () =>');
    expect(source).not.toContain('useEffect');
    expect(source).toContain('onClick={logout}');
  });

  it('does not race fallback restoration or clear it after temporary failures', () => {
    const source = read('src/lib/supabaseClient.js');
    const restore = source.slice(source.indexOf('export const restoreAuthSession'));
    expect(restore).not.toContain('Promise.race');
    expect(restore).toContain('isDefinitiveSessionError(error)');
  });

  it('refreshes Realtime authentication when the JWT rotates', () => {
    const source = read('src/lib/AuthContext.jsx');
    expect(source).toContain("event === 'TOKEN_REFRESHED'");
    expect(source).toContain('supabase.realtime.setAuth(session.access_token)');
  });

  it('invalidates delayed profile and token work before session side effects', () => {
    const source = read('src/lib/AuthContext.jsx');
    const validation = source.slice(
      source.indexOf('const validateProfileSession'),
      source.indexOf('// ─── Inicialização do estado de autenticação'),
    );
    const firstGenerationGuard = validation.indexOf('generation !== authGeneration.current');
    expect(firstGenerationGuard).toBeGreaterThan(-1);
    expect(firstGenerationGuard).toBeLessThan(validation.indexOf('persistAuthSession(session)'));
    expect(validation).toContain('!authSessionAllowed.current || generation !== authGeneration.current');
    expect(validation).toContain('if (!profileRetry.current.timer)');
    expect(validation).toContain(
      'if (!authSessionAllowed.current || generation !== authGeneration.current) return;',
    );

    const authEvents = source.slice(
      source.indexOf('supabase.auth.onAuthStateChange'),
      source.indexOf('return () =>', source.indexOf('supabase.auth.onAuthStateChange')),
    );
    expect(authEvents).toContain('const eventGeneration = authGeneration.current');
    expect(authEvents).toContain('const eventSessionAllowed = authSessionAllowed.current');
    expect(authEvents).toContain('!eventSessionAllowed');
    expect(authEvents).toContain('eventGeneration !== authGeneration.current');
    expect(authEvents.indexOf('eventGeneration !== authGeneration.current'))
      .toBeLessThan(authEvents.indexOf('persistAuthSession(session)'));
  });

  it('requires confirmation before activating a waiting service worker', () => {
    const config = read('vite.config.js');
    const prompt = read('src/components/PwaUpdatePrompt.jsx');
    expect(config).toContain("registerType: 'prompt'");
    expect(config).toContain('skipWaiting: false');
    expect(config).toContain('clientsClaim: false');
    expect(prompt).toContain("postMessage({ type: 'SKIP_WAITING' })");
    expect(prompt).not.toContain('indexedDB.deleteDatabase');
  });
});
