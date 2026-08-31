import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { loadConfig } from './config.mjs';
import { DurableMemoryQueue } from './durableMemoryQueue.mjs';
import { SupabaseBatchSink } from './supabaseBatchSink.mjs';

const config = loadConfig();
const queue = new DurableMemoryQueue(config.spoolFile);
const sink = new SupabaseBatchSink(config);
let flushing = false;
let shuttingDown = false;

function buildReading(tag, payload = {}) {
  const normalizedTag = String(tag || '').trim();
  if (!normalizedTag) throw new Error('tag_lida é obrigatória.');

  return {
    client_event_id: crypto.randomUUID(),
    tag_lida: normalizedTag,
    timestamp_leitura: new Date().toISOString(),
    reader_type: payload.reader_type || config.readerType,
    device_id: payload.device_id || config.deviceId,
    payload,
  };
}

async function enqueueReading(tag, payload = {}) {
  const startedAt = performance.now();
  const reading = buildReading(tag, payload);
  const queueSize = await queue.enqueue(reading);
  return {
    accepted: true,
    client_event_id: reading.client_event_id,
    queue_size: queueSize,
    ack_ms: Number((performance.now() - startedAt).toFixed(3)),
  };
}

async function flushQueue() {
  if (flushing || shuttingDown || queue.size === 0) return;
  flushing = true;
  const batch = queue.take(config.maxBatchSize);

  try {
    const confirmed = await sink.insertBatch(batch);
    await queue.commit();

    const functionalErrors = confirmed.filter(
      (row) => row.status_sincronizacao === 'erro',
    );
    console.log(JSON.stringify({
      event: 'micro_batch_committed',
      sent: batch.length,
      confirmed: confirmed.length,
      functional_errors: functionalErrors.length,
      queue_remaining: queue.size,
    }));
  } catch (error) {
    queue.prepend(batch);
    console.error(JSON.stringify({
      event: 'micro_batch_requeued',
      sent: batch.length,
      queue_size: queue.size,
      error: error.message,
      code: error.code || null,
    }));
  } finally {
    flushing = false;
  }
}

async function readJson(request) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;
    if (total > 1024 * 1024) {
      throw new Error('Payload acima de 1 MB.');
    }
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, {
        ok: true,
        online: true,
        flushing,
        queue_size: queue.size,
        flush_interval_ms: config.flushIntervalMs,
        max_batch_size: config.maxBatchSize,
      });
      return;
    }

    if (request.method === 'POST' && request.url === '/readings') {
      const body = await readJson(request);
      const result = await enqueueReading(
        body.tag_lida ?? body.tag ?? body.code,
        body,
      );
      sendJson(response, 202, result);
      return;
    }

    sendJson(response, 404, {
      error: 'Use POST /readings ou GET /health.',
    });
  } catch (error) {
    sendJson(response, 400, {
      accepted: false,
      error: error.message,
    });
  }
});

async function simulate() {
  for (let index = 0; index < config.simulateCount; index += 1) {
    const tag = String(9950001 + index).padStart(8, '0');
    const result = await enqueueReading(tag, { simulated: true });
    console.log(JSON.stringify({
      event: 'hardware_ack',
      tag,
      ...result,
    }));
    await new Promise((resolve) => {
      setTimeout(resolve, config.simulateIntervalMs);
    });
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(flushTimer);
  console.log(JSON.stringify({ event: 'shutdown', signal }));

  // Reativa temporariamente o flush para uma última tentativa controlada.
  shuttingDown = false;
  await flushQueue();
  shuttingDown = true;

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

const recovered = await queue.init();
await sink.authenticate();

server.listen(config.port, () => {
  console.log(JSON.stringify({
    event: 'edge_worker_ready',
    port: config.port,
    recovered,
    flush_interval_ms: config.flushIntervalMs,
    max_batch_size: config.maxBatchSize,
  }));
});

const flushTimer = setInterval(() => {
  flushQueue().catch((error) => {
    console.error('[edge-worker] flush não tratado:', error);
  });
}, config.flushIntervalMs);
flushTimer.unref();

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (process.argv.includes('--simulate')) {
  simulate().catch((error) => {
    console.error('[edge-worker] simulação falhou:', error);
  });
}
