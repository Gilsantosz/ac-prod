import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');

describe('contrato de deploy do Cloudflare Worker', () => {
  it('usa o fallback SPA nativo sem regra _redirects recursiva', () => {
    const redirectsPath = resolve(repoRoot, 'public/_redirects');
    const wranglerPath = resolve(repoRoot, 'wrangler.jsonc');
    const wranglerConfig = JSON.parse(readFileSync(wranglerPath, 'utf8'));

    expect(existsSync(redirectsPath)).toBe(false);
    expect(wranglerConfig.assets).toMatchObject({
      directory: './dist',
      not_found_handling: 'single-page-application',
    });
  });
});
