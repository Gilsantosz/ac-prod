import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('artifacts', {recursive:true});
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport:{width:1440,height:1180}});
  const errors = [];
  page.on('pageerror', error=>errors.push(error.message));
  // Test fixture is synthetic: prevent all external calls, including production.
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:5173/tests/fixtures/chart-glass.html', {waitUntil:'networkidle'});
  await page.locator('.recharts-bar-rectangle path').first().waitFor();
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('.ac-chart-host').count(),4);
  const fills = await page.locator('.recharts-bar-rectangle path').evaluateAll(nodes=>nodes.every(node=>{
    const fill=node.getAttribute('fill');const id=fill?.match(/^url\(#(.+)\)$/)?.[1];
    return id && node.closest('svg').querySelector(`[id="${id}"]`) && node.getBBox().width>0 && node.getBBox().height>0;
  }));
  assert.equal(fills,true);
  await writeFile('artifacts/charts-glass-dom.html', await page.content());
  console.log('Paint diagnostics', JSON.stringify(await page.locator('.recharts-bar-rectangle, .recharts-line-curve').evaluateAll(nodes => nodes.slice(0,3).map(n=>({html:n.outerHTML,transform:getComputedStyle(n).transform,clip:getComputedStyle(n).clipPath,animation:getComputedStyle(n).animation,box:n.getBoundingClientRect().toJSON()})))));
  await page.screenshot({path:'artifacts/charts-glass-desktop.png',fullPage:true});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.screenshot({path:'artifacts/charts-glass-no-motion.png',fullPage:true});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'Expandir gráfico',exact:true}).first().click();
  await page.getByRole('dialog').waitFor();
  // ResizeObserver supplies the new dialog dimensions after it becomes visible.
  await page.getByRole('dialog').locator('.recharts-bar-rectangle path').first().waitFor({state:'visible'});
  assert.equal(await page.locator('.recharts-wrapper').count(),4, 'Expansion must not duplicate the plot');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Ocultar gráfico',exact:true}).first().click();
  await page.getByRole('button',{name:'Mostrar gráfico oculto',exact:true}).click();
  await page.locator('.recharts-bar-rectangle path').first().hover();
  await page.locator('.recharts-tooltip-wrapper').first().waitFor({state:'visible'});
  await page.locator('.recharts-bar-rectangle path').first().click();
  await page.getByRole('status').waitFor();
  await page.getByRole('button',{name:'Fechar detalhes',exact:true}).click();
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.recharts-bar-rectangle').first().evaluate(node=>getComputedStyle(node).animationName),'none');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'artifacts/charts-glass-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal page overflow');
  await page.setViewportSize({width:1440,height:1180});
  await page.evaluate(()=>document.documentElement.classList.add('dark'));
  await page.screenshot({path:'artifacts/charts-glass-dark.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: 4 plots; paint servers; expand; hide/restore; hover/click tooltip; reduced motion; mobile; no external traffic or JS errors.');
} finally { await browser.close(); }
