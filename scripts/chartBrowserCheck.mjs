import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { mkdir, readFile } from 'node:fs/promises';
await mkdir('artifacts', { recursive: true });
const browser = await chromium.launch();

async function settle(page) {
  await page.waitForFunction(() => document.querySelectorAll('.recharts-wrapper > svg').length === 4);
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState === 'finished' || a.playState === 'idle'));
}
async function assertPaint(page) {
  const surfaces = page.locator('.recharts-wrapper > .recharts-surface');
  assert.equal(await surfaces.count(), 4);
  for (let index = 0; index < 4; index++) {
    // A valid DOM/bounding box is insufficient: assert actual rendered green pixels.
    const png = await surfaces.nth(index).screenshot({ animations: 'allow' });
    const painted = await page.evaluate(async (base64) => {
      const img = new Image(); img.src = `data:image/png;base64,${base64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const context = canvas.getContext('2d'); context.drawImage(img, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 1] > 90 && pixels[i + 1] > pixels[i] * 1.3 && pixels[i + 1] > pixels[i + 2] * 1.1) count++;
      }
      return count;
    }, png.toString('base64'));
    assert.ok(painted > 500, `Plot ${index + 1}: bars/line must be painted, not just legend/dots (${painted} green pixels)`);
  }
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1180 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Synthetic fixture only. Never contact production or any external host.
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:5173/tests/fixtures/chart-glass.html', { waitUntil: 'networkidle' });
  await settle(page);
  const fills = await page.locator('.recharts-bar-rectangle path').evaluateAll(nodes => nodes.length > 0 && nodes.every(node => {
    const id = node.getAttribute('fill')?.match(/^url\(#(.+)\)$/)?.[1];
    return id && node.closest('svg').querySelector(`[id="${id}"]`) && node.getBBox().width > 0 && node.getBBox().height > 0;
  }));
  assert.equal(fills, true);
  await page.screenshot({ path: 'artifacts/charts-glass-desktop.png', fullPage: true });
  await assertPaint(page);
  await page.getByRole('button', { name: 'Expandir gráfico', exact: true }).first().click();
  await page.getByRole('dialog').locator('.recharts-bar-rectangle path').first().waitFor({ state: 'visible' });
  await settle(page);
  assert.equal(await page.locator('.recharts-wrapper').count(), 4, 'Expansion must not duplicate plots');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Ocultar gráfico', exact: true }).first().click();
  await page.getByRole('button', { name: 'Mostrar gráfico oculto', exact: true }).click();
  const firstHost = page.locator('.ac-chart-host').first();
  const firstBar = firstHost.locator('.recharts-bar-rectangle path').first();
  await firstBar.waitFor({ state: 'visible' });
  await settle(page);
  await firstBar.hover();
  await firstHost.locator('.recharts-tooltip-wrapper').waitFor({ state: 'visible' });
  await firstBar.click();
  await page.getByRole('status').waitFor();
  await page.getByRole('button', { name: 'Fechar detalhes', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await firstHost.locator('.recharts-bar-rectangle').first().evaluate(node => getComputedStyle(node).animationName), 'none');
  await assertPaint(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/charts-glass-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal overflow');
  await page.setViewportSize({ width: 1440, height: 1180 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.screenshot({ path: 'artifacts/charts-glass-dark.png', fullPage: true });
  // Validate the downloadable single-file build, not only the Vite development fixture.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setContent(await readFile('artifacts/charts-glass-preview.html', 'utf8'), { waitUntil: 'load' });
  await settle(page);
  await assertPaint(page);
  await page.getByRole('button', { name: 'Expandir gráfico', exact: true }).first().click();
  await page.getByRole('dialog').locator('.recharts-bar-rectangle path').first().waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('PASS: four painted charts; gradients; expand; hide/restore; hover/click tooltip; reduced motion; mobile; dark; offline HTML; no external traffic or JS errors.');
} finally { await browser.close(); }
