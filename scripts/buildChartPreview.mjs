import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
// Synthetic, disconnected fixture. Bundle into one offline HTML for review.
await build({ configFile: false, plugins: [react()], base: './', build: {
  outDir: 'artifacts/chart-preview-assets', emptyOutDir: true,
  rollupOptions: { input: 'tests/fixtures/chart-glass.html', output: { inlineDynamicImports: true } },
} });
const file = 'artifacts/chart-preview-assets/tests/fixtures/chart-glass.html';
let html = await readFile(file, 'utf8');
for (const match of [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)]) {
  const js = await readFile(path.resolve(path.dirname(file), match[1]), 'utf8');
  html = html.replace(match[0], `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`);
}
for (const match of [...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)]) {
  const css = await readFile(path.resolve(path.dirname(file), match[1]), 'utf8');
  html = html.replace(match[0], `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`);
}
await writeFile('artifacts/charts-glass-preview.html', html);
console.log('Built standalone, synthetic preview: artifacts/charts-glass-preview.html');
