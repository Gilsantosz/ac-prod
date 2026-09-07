import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataPage, formatChartValue, readChartValue, seriesPaint } from '../src/components/charts/chartModel.mjs';
import chartPresentationPlugin from './chartPresentationPlugin.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('missing values are not zero; zero and precision are preserved', () => {
  for (const absent of [null, undefined, NaN, Infinity, '']) assert.equal(formatChartValue(absent), '—');
  assert.equal(formatChartValue(0), '0'); assert.equal(formatChartValue(7.34), '7,34');
  assert.equal(formatChartValue(105.12345), '105,12345');
});
test('pagination never mutates, truncates or sorts the plotted data', () => {
  const rows = Object.freeze(Array.from({ length: 45 }, (_, n) => Object.freeze({ n })));
  assert.deepEqual(dataPage(rows, 1).rows.map(r => r.n), Array.from({length:20},(_,i)=>i+20));
  assert.equal(dataPage(rows, 999).rows.length, 5); assert.equal(dataPage(rows, -1).page, 0);
  assert.equal(rows.length,45); assert.equal(dataPage([],0).pageCount,1);
});
test('accessors support path and function, and reject inherited values', () => {
  assert.equal(readChartValue({a:{b:13}},'a.b'),13); assert.equal(readChartValue({n:7},r=>r.n),7);
  assert.equal(readChartValue({},'constructor'),undefined);
});
test('quality colors and existing gradient URLs are preserved', () => {
  assert.deepEqual(seriesPaint({dataKey:'refugo',fill:'#ef4444'},'Bar'), ['#ef4444','#ef4444']);
  assert.equal(seriesPaint({fill:'url(#existing)'},'Bar'),null);
  assert.deepEqual(seriesPaint({dataKey:'Produzido'},'Bar'),['#34d399','#15803d']);
});
test('Vite routes all application chart imports, without recursion or affecting vendors', () => {
  const plugin=chartPresentationPlugin();
  const output=plugin.resolveId('recharts',path.join(root,'src/pages/Quality.jsx'));
  assert.equal(output,path.join(root,'src/components/charts/recharts.jsx'));
  assert.equal(plugin.resolveId('recharts',output),null);
  assert.equal(plugin.resolveId('recharts',path.join(root,'node_modules/vendor/src/index.js')),null);
  assert.equal(plugin.resolveId('react',path.join(root,'src/pages/Quality.jsx')),null);
});
