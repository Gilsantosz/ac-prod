import { timingSafeEqual } from 'node:crypto';
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

function headerValue(value) {
  return Array.isArray(value) ? value[0] : String(value || '');
}

function secureEquals(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(request) {
  if (!config.ingestToken) return true;

  const authorization = headerValue(request.headers.authorization);
  const bearer = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
  const headerToken = headerValue(request.headers['x-edge-token']).trim();
  return secureEquals(headerToken || bearer, config.ingestToken);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, {
        ok: true,
        accepting_readings: true,
        flushing,
        queue_size: queue.size,
        flush_interval_ms: config.flushIntervalMs,
        max_batch_size: config.maxBatchSize,
      });
      return;
    }

    if (request.method === 'POST' && request.url === '/readings') {
      if (!isAuthorized(request)) {
        sendJson(response, 401, {
          accepted: false,
          error: 'Token local do equipamento inválido.',
        });
        return;
      }

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
    // Código intencionalmente inválido (7 dígitos): valida transporte, fila,
    // bulk insert e retorno sem dar baixa em uma peça real de produção.
    const tag = String(9_000_001 + (index % 999_998)).padStart(7, '0');
    const result = await enqueueReading(tag, {
      simulated: true,
      simulation_scope: 'transport_only_no_production_mutation',
    });
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

server.on('error', (error) => {
  console.error(JSON.stringify({
    event: 'edge_worker_server_error',
    error: error.message,
    code: error.code || null,
  }));
  process.exitCode = 1;
});

server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({
    event: 'edge_worker_ready',
    host: config.host,
    port: config.port,
    recovered,
    flush_interval_ms: config.flushIntervalMs,
    max_batch_size: config.maxBatchSize,
    local_auth_enabled: Boolean(config.ingestToken),
  }));
});

// A indisponibilidade do Supabase na inicialização nunca impede a coleta local.
// O próprio insertBatch repetirá a autenticação em cada tentativa de flush.
sink.authenticate()
  .then(() => console.log(JSON.stringify({ event: 'edge_worker_authenticated' })))
  .catch((error) => console.error(JSON.stringify({
    event: 'edge_worker_auth_deferred',
    error: error.message,
  })));

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
