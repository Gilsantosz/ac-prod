import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the actual service without browser credentials, dependencies, or production writes.
const source = readFileSync(new URL('../src/lib/manualProductionService.js', import.meta.url), 'utf8');
const executable = source.replace(/^import .*;\n/gm, '').replaceAll('export async function', 'async function');
assert.ok(!/^import /m.test(executable), 'Update the test harness when service imports change.');
const base = { pcp_import_batch_id: 'batch-1', general_lot_code: '15815', cell_name: 'Embalagem', quantity: 5, date: '2026-09-21' };
const session = { session_id: 'session-1', token: 'test-only-not-a-real-token', device_id: 'test-device', name: 'Test Operator', shift: '2º Turno', context: { cellName: 'Embalagem' } };
const batch = (id) => ({ id, general_lot_code: id, status: 'processed', progress_percent: 0 });
const progress = (remaining = 10) => ({ stage_code: 'packaging', required_pieces: 10, remaining_pieces: remaining });
function harness({ op = null, rpc = async () => ({ data: { success: true }, error: null }), batches = [] } = {}) {
  const calls = [];
  const supabase = {
    rpc: (...args) => { calls.push(args); return rpc(...args); },
    from() {
      const query = { select() { return query; }, not() { return query; }, order() { return query; }, limit() { return Promise.resolve({ data: batches, error: null }); } };
      return query;
    },
  };
  const api = new Function('supabase', 'canonicalProductionStage', 'getOperatorSession', 'getConfirmedOperatorContext',
    `${executable}\nreturn { registerManualQuantitativeEntry, fetchAvailableGeneralLots };`)(
    supabase, (cell) => cell ? 'packaging' : null, () => op, (value) => value.context || null,
  );
  return { ...api, calls };
}

test('transmits operational token only at RPC boundary and uses confirmed identity', async () => {
  const h = harness({ op: session });
  await h.registerManualQuantitativeEntry({ ...base, operator: 'Untrusted name' });
  const sent = h.calls[0][1].p_payload;
  assert.equal(sent.operator, session.name);
  assert.equal(sent.operatorSessionToken, session.token);
  assert.equal(sent.deviceId, session.device_id);
  assert.match(sent.client_event_id, /^manual-volume-/);
});
test('preserves existing administrative entry without an operational session', async () => {
  const h = harness();
  assert.equal((await h.registerManualQuantitativeEntry(base)).success, true);
  assert.equal(h.calls[0][1].p_payload.operatorSessionToken, undefined);
});
test('rejects a different or unconfirmed workstation before network writes', async () => {
  for (const op of [{ ...session, context: null }, { ...session, context_pending: true }, { ...session, token: null }, { ...session, context: { cellName: 'Corte' } }]) {
    const h = harness({ op });
    await assert.rejects(h.registerManualQuantitativeEntry(base), /Confirme a célula/);
    assert.equal(h.calls.length, 0);
  }
});
test('rejects zero, fractions, negative and overflowing quantities', async () => {
  const h = harness();
  for (const quantity of [0, -1, 1.2, 2147483648, NaN]) await assert.rejects(h.registerManualQuantitativeEntry({ ...base, quantity }), /inteiro/);
  assert.equal(h.calls.length, 0);
});
test('reuses the event after uncertain network result and creates a new one after confirmation', async () => {
  let attempt = 0;
  const h = harness({ rpc: async () => ++attempt === 1 ? { data: null, error: { message: 'Network unavailable' } } : { data: { success: true }, error: null } });
  await assert.rejects(h.registerManualQuantitativeEntry(base), /Network unavailable/);
  await h.registerManualQuantitativeEntry(base);
  await h.registerManualQuantitativeEntry(base);
  const ids = h.calls.map((c) => c[1].p_payload.client_event_id);
  assert.equal(ids[0], ids[1]);
  assert.notEqual(ids[1], ids[2]);
});
test('coalesces simultaneous submits into one RPC', async () => {
  let resolve;
  const h = harness({ rpc: () => new Promise((r) => { resolve = r; }) });
  const first = h.registerManualQuantitativeEntry(base);
  const second = h.registerManualQuantitativeEntry(base);
  assert.equal(h.calls.length, 1);
  resolve({ data: { success: true }, error: null });
  assert.deepEqual(await first, await second);
});
test('preserves server business error messages', async () => {
  const h = harness({ rpc: async () => ({ data: { success: false, error: 'Quantidade acima do saldo.' }, error: null }) });
  await assert.rejects(h.registerManualQuantitativeEntry(base), /Quantidade acima do saldo/);
});
test('loads only the scoped manual-volume balance RPC', async () => {
  const h = harness({ batches: [batch('a')], rpc: async () => ({ data: { stage_progress: progress() }, error: null }) });
  const lots = await h.fetchAvailableGeneralLots(100, { cellName: 'Embalagem' });
  assert.equal(h.calls[0][0], 'get_manual_volume_stage_progress');
  assert.deepEqual(h.calls[0][1], { p_batch_id: 'a', p_cell_name: 'Embalagem' });
  assert.equal(lots[0].stageProgress.remaining_pieces, 10);
});
test('a timeout is reported rather than converted to zero balance', async () => {
  const h = harness({ batches: [batch('a')], rpc: async () => ({ data: null, error: { code: '57014', message: 'statement timeout' } }) });
  await assert.rejects(h.fetchAvailableGeneralLots(100, { cellName: 'Embalagem' }), /saldo do Lote a: statement timeout/);
});
test('missing server response is not reported as an empty stage', async () => {
  const h = harness({ batches: [batch('a')], rpc: async () => ({ data: null, error: null }) });
  await assert.rejects(h.fetchAvailableGeneralLots(100, { cellName: 'Embalagem' }), /não confirmou o saldo/);
});
test('filters completed and non-required stages', async () => {
  const h = harness({ batches: [batch('a'), batch('b'), batch('c')], rpc: async (_, args) => ({ data: { stage_progress: args.p_batch_id === 'a' ? null : progress(args.p_batch_id === 'b' ? 0 : 10) }, error: null }) });
  const lots = await h.fetchAvailableGeneralLots(100, { cellName: 'Embalagem' });
  assert.deepEqual(lots.map((lot) => lot.batchId), ['c']);
});
test('caps concurrent balance queries at three', async () => {
  let running = 0; let maximum = 0;
  const h = harness({ batches: Array.from({ length: 8 }, (_, i) => batch(String(i))), rpc: async () => {
    running++; maximum = Math.max(maximum, running);
    await new Promise((resolve) => setTimeout(resolve, 2)); running--;
    return { data: { stage_progress: progress() }, error: null };
  } });
  const lots = await h.fetchAvailableGeneralLots(100, { cellName: 'Embalagem' });
  assert.equal(lots.length, 8); assert.equal(maximum, 3);
});
