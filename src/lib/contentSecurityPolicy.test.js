import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_PROJECT_REF, TEST_PROJECT_REF } from '@/lib/runtimeEnvironment';

const indexHtml = readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');

function contentSecurityPolicy() {
  const document = new DOMParser().parseFromString(indexHtml, 'text/html');
  return document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '';
}

describe('Content Security Policy', () => {
  it.each([
    ['produção', PRODUCTION_PROJECT_REF],
    ['teste isolado', TEST_PROJECT_REF],
  ])('autoriza conexões HTTPS e Realtime do Supabase de %s', (_environment, projectRef) => {
    const policy = contentSecurityPolicy();

    expect(policy).toContain(`https://${projectRef}.supabase.co`);
    expect(policy).toContain(`wss://${projectRef}.supabase.co`);
  });
});
