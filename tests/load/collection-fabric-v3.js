import http from 'k6/http';
import ws from 'k6/ws';
import execution from 'k6/execution';
import { check, fail, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

/*
 * AC.Prod Collection Fabric v3 — workload mutante de capacidade.
 *
 * Este arquivo NAO prepara massa nem habilita flags. O alvo normal continua
 * sendo staging. A unica excecao aceita e o projeto AC.Prod explicitamente
 * autorizado enquanto ele ainda e um ambiente de teste; essa excecao exige
 * tres confirmacoes exatas abaixo. Cada execucao escreve recibos, fatos e
 * projecoes produtivas persistentes. Consulte o runbook antes de executar.
 */

const supabaseUrl = (__ENV.SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = __ENV.SUPABASE_ANON_KEY || '';
const fixturePath = __ENV.K6_FIXTURES || '';
const profile = (__ENV.K6_PROFILE || 'smoke').toLowerCase();
const runId = __ENV.K6_RUN_ID || '';
const sequenceBase = Number(__ENV.K6_SEQUENCE_BASE || 0);
const productionProjectRef = 'uozuzdfvnufsjsonswag';
const authorizedTestProductionUrl = `https://${productionProjectRef}.supabase.co`;
const authorizedTestProductionConfirmation =
  'EU-AUTORIZO-ESCRITAS-K6-DESTRUTIVAS-NO-ACPROD-TESTE-uozuzdfvnufsjsonswag';
const target = __ENV.K6_TARGET || '';
const writesConfirmation = __ENV.K6_CONFIRM_WRITES || '';

if (!supabaseUrl || !anonKey || !fixturePath) {
  fail('Defina SUPABASE_URL, SUPABASE_ANON_KEY e K6_FIXTURES.');
}
if (target === 'staging') {
  if (writesConfirmation !== 'staging-v3-load') {
    fail('Carga mutante bloqueada: staging exige K6_CONFIRM_WRITES=staging-v3-load.');
  }
  if (supabaseUrl.includes(productionProjectRef)) {
    fail('Carga staging bloqueada no projeto AC.Prod de teste/producao. Use K6_TARGET=test-production somente com a autorizacao documentada.');
  }
} else if (target === 'test-production') {
  if (
    supabaseUrl !== authorizedTestProductionUrl
    || writesConfirmation !== authorizedTestProductionConfirmation
  ) {
    fail(
      'Carga test-production bloqueada: exige a URL exata do projeto AC.Prod de teste '
      + 'e a frase forte/especifica documentada no runbook.',
    );
  }
} else {
  fail('Carga mutante bloqueada: K6_TARGET deve ser staging ou test-production.');
}
if (!/^[a-zA-Z0-9_-]{1,32}$/.test(runId)) {
  fail('K6_RUN_ID deve ter de 1 a 32 caracteres [a-zA-Z0-9_-] e ser unico por rodada.');
}
if (!Number.isSafeInteger(sequenceBase) || sequenceBase < 1) {
  fail('K6_SEQUENCE_BASE deve ser um inteiro positivo, reservado para esta rodada.');
}

const fixture = JSON.parse(open(fixturePath));
const devices = Array.isArray(fixture.devices) ? fixture.devices : [];
const codes = Array.isArray(fixture.codes) ? fixture.codes.map(String) : [];

const allowedProfiles = new Set([
  'smoke',
  'nominal',
  'burst',
  'microbatch',
  'priority',
  'idempotency',
  'contention_piece',
  'contention_cell_lot',
]);
if (!allowedProfiles.has(profile)) {
  fail(
    'K6_PROFILE invalido. Use smoke, nominal, burst, microbatch, priority, '
    + 'idempotency, contention_piece ou contention_cell_lot.',
  );
}

const ackMs = new Trend('collection_ingress_ack_ms', true);
const decisionMs = new Trend('collection_decision_ms', true);
const liveDecisionMs = new Trend('collection_live_decision_ms', true);
const replayDecisionMs = new Trend('collection_replay_decision_ms', true);
const projectionMs = new Trend('collection_projection_ms', true);
const queueAgeMs = new Trend('collection_queue_age_ms', true);
const serverProcessingP95Ms = new Trend('collection_server_processing_p95_ms', true);
const serverProcessingP99Ms = new Trend('collection_server_processing_p99_ms', true);
const serverProjectionP95Ms = new Trend('collection_server_projection_p95_ms', true);
const serverQueueP99Ms = new Trend('collection_server_queue_p99_ms', true);
const serverRetryRate = new Trend('collection_server_retry_rate');
const realtimeJoinMs = new Trend('collection_realtime_join_ms', true);
const contentionLaunchLagMs = new Trend('collection_contention_launch_lag_ms', true);

const ingressFailures = new Counter('collection_ingress_failures');
const persistenceFailures = new Counter('collection_persistence_failures');
const observationFailures = new Counter('collection_observation_failures');
const unfinalizedEvents = new Counter('collection_unfinalized_events');
const unprojectedEvents = new Counter('collection_unprojected_events');
const deadLetteredEvents = new Counter('collection_dead_lettered_events');
const idempotencyViolations = new Counter('collection_idempotency_violations');
const serverDeadlocks = new Counter('collection_server_deadlocks');
const serverStatementTimeouts = new Counter('collection_server_statement_timeouts');
const serverDlqMessages = new Counter('collection_server_dlq_messages');
const finalHealthFailures = new Counter('collection_final_health_failures');
const realtimeConnectionFailures = new Counter('collection_realtime_connection_failures');
const realtimeDevicesWithoutFinalized = new Counter('collection_realtime_devices_without_finalized');
const contentionWindowViolations = new Counter('collection_contention_window_violations');
const contentionContextViolations = new Counter('collection_contention_context_violations');
const contentionPieceOutcomes = new Counter('collection_contention_piece_outcomes');
const contentionPieceApprovals = new Counter('collection_contention_piece_approvals');
const contentionPieceBlockedOrDuplicated = new Counter(
  'collection_contention_piece_blocked_or_duplicated',
);
const contentionCellLotOutcomes = new Counter('collection_contention_cell_lot_outcomes');
const contentionCellLotApprovals = new Counter('collection_contention_cell_lot_approvals');

const commonThresholds = {
  checks: ['rate==1'],
  dropped_iterations: ['count==0'],
  collection_ingress_failures: ['count==0'],
  collection_persistence_failures: ['count==0'],
  collection_observation_failures: ['count==0'],
  collection_unfinalized_events: ['count==0'],
  collection_unprojected_events: ['count==0'],
  collection_dead_lettered_events: ['count==0'],
  collection_ingress_ack_ms: ['p(95)<250'],
  collection_decision_ms: ['p(95)<800', 'p(99)<2000'],
  collection_projection_ms: ['p(95)<500'],
  collection_queue_age_ms: ['p(99)<2000'],
  collection_server_processing_p95_ms: ['max<800'],
  collection_server_processing_p99_ms: ['max<2000'],
  collection_server_projection_p95_ms: ['max<500'],
  collection_server_queue_p99_ms: ['max<2000'],
  collection_server_retry_rate: ['max<0.01'],
  collection_server_deadlocks: ['count==0'],
  collection_server_statement_timeouts: ['count==0'],
  collection_server_dlq_messages: ['count==0'],
  collection_final_health_failures: ['count==0'],
  collection_realtime_connection_failures: ['count==0'],
};

const scenarioProfiles = {
  smoke: {
    smoke: {
      executor: 'per-vu-iterations',
      exec: 'smoke',
      vus: 1,
      iterations: 1,
      maxDuration: '30s',
    },
  },
  nominal: {
    hundred_private_device_connections: {
      executor: 'per-vu-iterations',
      exec: 'connectedDevice',
      vus: 100,
      iterations: 1,
      maxDuration: '10m20s',
    },
    nominal_30_events_per_second: {
      executor: 'constant-arrival-rate',
      exec: 'nominal',
      startTime: '2s',
      rate: 30,
      timeUnit: '1s',
      duration: '10m',
      preAllocatedVUs: 100,
      maxVUs: 100,
      gracefulStop: '30s',
    },
  },
  burst: {
    burst_100_events_per_second: {
      executor: 'constant-arrival-rate',
      exec: 'burst',
      rate: 100,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 100,
      maxVUs: 200,
      gracefulStop: '30s',
    },
  },
  microbatch: {
    five_parallel_batches_of_25: {
      executor: 'per-vu-iterations',
      exec: 'microbatch',
      vus: 5,
      iterations: 1,
      maxDuration: '45s',
    },
  },
  priority: {
    replay_backlog_seed: {
      executor: 'per-vu-iterations',
      exec: 'priorityReplaySeed',
      vus: 5,
      iterations: 1,
      maxDuration: '45s',
    },
    live_4_share: {
      executor: 'constant-arrival-rate',
      exec: 'priorityLive',
      startTime: '1s',
      rate: 20,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 40,
      maxVUs: 100,
      gracefulStop: '30s',
    },
    replay_1_share: {
      executor: 'constant-arrival-rate',
      exec: 'priorityReplay',
      startTime: '1s',
      rate: 5,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 10,
      maxVUs: 40,
      gracefulStop: '30s',
    },
  },
  idempotency: {
    repeated_client_event_id: {
      executor: 'per-vu-iterations',
      exec: 'idempotency',
      vus: 20,
      iterations: 1,
      maxDuration: '45s',
    },
  },
  contention_piece: {
    twenty_machines_same_piece_within_100ms: {
      executor: 'per-vu-iterations',
      exec: 'contentionSamePiece',
      vus: 20,
      iterations: 1,
      maxDuration: '45s',
    },
  },
  contention_cell_lot: {
    fifty_machines_same_cell_lot_distinct_pieces: {
      executor: 'per-vu-iterations',
      exec: 'contentionSameCellLot',
      vus: 50,
      iterations: 1,
      maxDuration: '45s',
    },
  },
};

const profileThresholds = profile === 'idempotency'
  ? { collection_idempotency_violations: ['count==0'] }
  : {};
if (profile === 'priority') {
  profileThresholds.collection_live_decision_ms = ['p(95)<800', 'p(99)<2000'];
}
if (profile === 'nominal') {
  profileThresholds.collection_realtime_devices_without_finalized = ['count==0'];
}
if (profile === 'contention_piece') {
  profileThresholds.collection_contention_launch_lag_ms = ['max<=100'];
  profileThresholds.collection_contention_window_violations = ['count==0'];
  profileThresholds.collection_contention_context_violations = ['count==0'];
  profileThresholds.collection_contention_piece_outcomes = ['count==20'];
  profileThresholds.collection_contention_piece_approvals = ['count==1'];
  profileThresholds.collection_contention_piece_blocked_or_duplicated = ['count==19'];
}
if (profile === 'contention_cell_lot') {
  profileThresholds.collection_contention_launch_lag_ms = ['max<=100'];
  profileThresholds.collection_contention_window_violations = ['count==0'];
  profileThresholds.collection_contention_context_violations = ['count==0'];
  profileThresholds.collection_contention_cell_lot_outcomes = ['count==50'];
  profileThresholds.collection_contention_cell_lot_approvals = ['count==50'];
}

export const options = {
  scenarios: scenarioProfiles[profile],
  thresholds: { ...commonThresholds, ...profileThresholds },
  discardResponseBodies: false,
  userAgent: `acprod-collection-fabric-v3-k6/${runId}`,
};

const profileRequirements = {
  smoke: { devices: 1, codes: 1 },
  nominal: { devices: 100, codes: 18000 },
  burst: { devices: 100, codes: 6000 },
  microbatch: { devices: 5, codes: 125 },
  priority: { devices: 100, codes: 1625 },
  idempotency: { devices: 20, codes: 20 },
  contention_piece: { devices: 20, codes: 1 },
  contention_cell_lot: { devices: 50, codes: 50 },
};

const scenarioOffsets = {
  smoke: 0,
  nominal: 0,
  burst: 1_000_000,
  microbatch: 2_000_000,
  priority_replay_seed: 3_000_000,
  priority_live: 4_000_000,
  priority_replay: 5_000_000,
  idempotency: 6_000_000,
  contention_piece: 7_000_000,
  contention_cell_lot: 8_000_000,
};

function authHeaders(device) {
  const accessToken = device.access_token || fixture.access_token;
  return {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

function jsonResponse(response) {
  try {
    return response.json();
  } catch {
    return null;
  }
}

function rpc(functionName, body, device, tags = {}) {
  return http.post(
    `${supabaseUrl}/rest/v1/rpc/${functionName}`,
    JSON.stringify(body),
    {
      headers: authHeaders(device),
      tags: { operation: functionName, profile, ...tags },
      timeout: __ENV.K6_HTTP_TIMEOUT || '10s',
    },
  );
}

function realtimeUrl() {
  const websocketBase = supabaseUrl.replace(/^http/i, 'ws');
  return `${websocketBase}/realtime/v1/websocket?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`;
}

function decodeRealtimeMessage(rawMessage) {
  try {
    const parsed = JSON.parse(rawMessage);
    if (Array.isArray(parsed)) {
      const [join_ref, ref, topic, event, payload] = parsed;
      return { join_ref, ref, topic, event, payload };
    }
    return parsed;
  } catch {
    return null;
  }
}

function hash32(value, seed) {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function hex32(value) {
  return value.toString(16).padStart(8, '0');
}

function deterministicUuid(value) {
  const hex = [
    hex32(hash32(value, 0)),
    hex32(hash32(value, 1)),
    hex32(hash32(value, 2)),
    hex32(hash32(value, 3)),
  ].join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function iterationNumber() {
  return Number(execution.scenario.iterationInTest);
}

function selectDevice(iteration) {
  return devices[iteration % devices.length];
}

function eventCode(codeOffset, iteration, batchSize, eventIndex) {
  return codes[codeOffset + (iteration * batchSize) + eventIndex];
}

function createEvents(scenarioName, sourceMode, batchSize, iteration) {
  const offset = scenarioOffsets[scenarioName];
  const codeOffset = scenarioName === 'priority_live'
    ? 125
    : scenarioName === 'priority_replay'
      ? 1325
      : 0;
  const capturedAt = new Date(
    Date.now() - (sourceMode === 'offline_replay'
      ? Number(__ENV.K6_REPLAY_AGE_SECONDS || 60) * 1000
      : 0),
  ).toISOString();

  return Array.from({ length: batchSize }, (_, eventIndex) => ({
    client_event_id: `k6-v3:${runId}:${scenarioName}:${iteration}:${eventIndex}`,
    raw_value: eventCode(codeOffset, iteration, batchSize, eventIndex),
    reader_type: 'keyboard_barcode',
    captured_at_client: capturedAt,
    device_sequence: sequenceBase + offset + (iteration * 25) + eventIndex + 1,
    quantity: 1,
  }));
}

function submitBatch(scenarioName, sourceMode, batchSize, iteration = iterationNumber()) {
  const device = selectDevice(iteration);
  const events = createEvents(scenarioName, sourceMode, batchSize, iteration);
  const response = rpc(
    'ingest_collection_batch_v3',
    {
      p_batch_id: deterministicUuid(`${runId}:${scenarioName}:batch:${iteration}`),
      p_device_id: device.device_id,
      p_events: {
        operator_session_id: device.operator_session_id,
        source_mode: sourceMode,
        app_version: `k6-${runId}`,
        events,
      },
    },
    device,
    { source_mode: sourceMode, workload: scenarioName },
  );

  ackMs.add(response.timings.duration, { source_mode: sourceMode, workload: scenarioName });
  const body = jsonResponse(response);
  const results = Array.isArray(body?.results) ? body.results : [];
  const responseOk = response.status === 200 && results.length === events.length;

  if (!responseOk) ingressFailures.add(1, { source_mode: sourceMode, workload: scenarioName });
  const allPersisted = responseOk && results.every((result) => (
    result.persisted === true
    && !result.error_code
    && result.queue_status !== 'rejected'
  ));
  if (!allPersisted) persistenceFailures.add(1, { source_mode: sourceMode, workload: scenarioName });

  check(response, {
    'ingresso v3 responde 200': () => response.status === 200,
    'ACK contem um resultado por evento': () => results.length === events.length,
    'todos os eventos foram persistidos': () => allPersisted,
  });

  if (allPersisted) observeEvents(device, events, sourceMode, scenarioName);
  return { device, events, results, response };
}

function receiptUrl(clientEventIds) {
  const tuple = `(${clientEventIds.map((id) => `"${id}"`).join(',')})`;
  const select = [
    'client_event_id',
    'status_sincronizacao',
    'received_at_db',
    'enqueued_at',
    'processing_started_at',
    'decision_committed_at',
    'projected_at',
    'dead_lettered_at',
    'final_reason_code',
  ].join(',');
  return `${supabaseUrl}/rest/v1/coletas_producao?select=${select}&client_event_id=in.${encodeURIComponent(tuple)}`;
}

function ledgerUrl(clientEventId) {
  return `${supabaseUrl}/rest/v1/production_stage_readings?select=id,client_event_id,status,pipeline_version,lot_id,cell_name,machine_id&client_event_id=eq.${encodeURIComponent(clientEventId)}&pipeline_version=eq.3`;
}

function waitForCoordinatedLaunch(startAt) {
  let remainingMs = Number(startAt) - Date.now();
  if (!Number.isFinite(remainingMs)) fail('Barreira de contencao invalida.');
  while (remainingMs > 20) {
    sleep(Math.max(0.001, (remainingMs - 10) / 1000));
    remainingMs = Number(startAt) - Date.now();
  }
  while (Date.now() < Number(startAt)) {
    // Janela final curta: evita arredondamento de sleep espalhar o lançamento.
  }
  const launchLag = Math.max(0, Date.now() - Number(startAt));
  contentionLaunchLagMs.add(launchLag, { workload: profile });
  if (launchLag > 100) contentionWindowViolations.add(1, { workload: profile });
}

function submitContentionEvent(workload, code, setupData) {
  const vuIndex = Number(execution.vu.idInTest) - 1;
  const device = devices[vuIndex];
  const clientEventId = `k6-v3:${runId}:${workload}:${vuIndex}`;
  const event = {
    client_event_id: clientEventId,
    raw_value: code,
    reader_type: 'keyboard_barcode',
    captured_at_client: new Date().toISOString(),
    device_sequence: sequenceBase + scenarioOffsets[workload] + vuIndex + 1,
    quantity: 1,
  };

  waitForCoordinatedLaunch(setupData?.contention_launch_at);
  const response = rpc(
    'ingest_collection_batch_v3',
    {
      p_batch_id: deterministicUuid(`${runId}:${workload}:batch:${vuIndex}`),
      p_device_id: device.device_id,
      p_events: {
        operator_session_id: device.operator_session_id,
        source_mode: 'live',
        app_version: `k6-${runId}`,
        events: [event],
      },
    },
    device,
    { source_mode: 'live', workload },
  );
  ackMs.add(response.timings.duration, { source_mode: 'live', workload });
  const result = jsonResponse(response)?.results?.[0];
  const persisted = response.status === 200
    && result?.persisted === true
    && !result?.error_code;
  if (!persisted) {
    ingressFailures.add(1, { workload });
    persistenceFailures.add(1, { workload });
  }
  check(response, {
    'contencao ingressou com ACK persistido': () => persisted,
  });
  if (persisted) observeEvents(device, [event], 'live', workload);

  const ledgerResponse = http.get(ledgerUrl(clientEventId), {
    headers: authHeaders(device),
    tags: { operation: 'verify_contention_ledger', profile, workload },
  });
  const rows = jsonResponse(ledgerResponse);
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  const expected = fixture.contention || {};
  const contextMatches = Boolean(row)
    && (!expected.lot_id || row.lot_id === expected.lot_id)
    && (!expected.cell_name || row.cell_name === expected.cell_name)
    && (!device.machine_id || row.machine_id === device.machine_id);
  if (!contextMatches) contentionContextViolations.add(1, { workload });
  check(ledgerResponse, {
    'contencao gerou um unico fato canonico': () => Boolean(row),
    'fato preserva lote celula e maquina da fixture': () => contextMatches,
  });
  return row;
}

function observeEvents(device, events, sourceMode, workload) {
  const pendingDecision = new Set(events.map((event) => event.client_event_id));
  const pendingProjection = new Set(events.map((event) => event.client_event_id));
  const deadline = Date.now() + Number(__ENV.K6_RESULT_TIMEOUT_MS || 10000);
  const pollInterval = Number(__ENV.K6_RESULT_POLL_SECONDS || 0.1);

  while (pendingProjection.size > 0 && Date.now() < deadline) {
    const response = http.get(receiptUrl(events.map((event) => event.client_event_id)), {
      headers: authHeaders(device),
      tags: { operation: 'observe_collection_receipts', profile, source_mode: sourceMode, workload },
      timeout: __ENV.K6_HTTP_TIMEOUT || '10s',
    });

    if (response.status !== 200) {
      observationFailures.add(1, { source_mode: sourceMode, workload });
      sleep(pollInterval);
      continue;
    }

    const rows = jsonResponse(response);
    if (!Array.isArray(rows)) {
      observationFailures.add(1, { source_mode: sourceMode, workload });
      sleep(pollInterval);
      continue;
    }

    for (const row of rows) {
      if (row.dead_lettered_at && pendingDecision.has(row.client_event_id)) {
        deadLetteredEvents.add(1, { source_mode: sourceMode, workload });
        pendingDecision.delete(row.client_event_id);
        pendingProjection.delete(row.client_event_id);
        continue;
      }

      if (row.decision_committed_at && pendingDecision.has(row.client_event_id)) {
        const latency = new Date(row.decision_committed_at).getTime()
          - new Date(row.received_at_db).getTime();
        decisionMs.add(latency, { source_mode: sourceMode, workload });
        if (sourceMode === 'live') liveDecisionMs.add(latency, { workload });
        else replayDecisionMs.add(latency, { workload });

        if (row.processing_started_at && row.enqueued_at) {
          queueAgeMs.add(
            new Date(row.processing_started_at).getTime() - new Date(row.enqueued_at).getTime(),
            { source_mode: sourceMode, workload },
          );
        }
        pendingDecision.delete(row.client_event_id);
      }

      if (row.projected_at && pendingProjection.has(row.client_event_id)) {
        if (row.decision_committed_at) {
          projectionMs.add(
            new Date(row.projected_at).getTime() - new Date(row.decision_committed_at).getTime(),
            { source_mode: sourceMode, workload },
          );
        }
        pendingProjection.delete(row.client_event_id);
      }
    }

    if (pendingProjection.size > 0) sleep(pollInterval);
  }

  if (pendingDecision.size > 0) {
    unfinalizedEvents.add(pendingDecision.size, { source_mode: sourceMode, workload });
  }
  if (pendingProjection.size > 0) {
    unprojectedEvents.add(pendingProjection.size, { source_mode: sourceMode, workload });
  }
}

function fetchHealth(device) {
  const response = rpc('get_collection_runtime_health_v3', {}, device, { workload: 'health' });
  return response.status === 200 ? jsonResponse(response) : null;
}

function validateFixture() {
  const requirement = profileRequirements[profile];
  if (devices.length < requirement.devices) {
    fail(`Fixture insuficiente: ${profile} exige ${requirement.devices} dispositivos distintos.`);
  }
  if (codes.length < requirement.codes) {
    fail(`Fixture insuficiente: ${profile} exige ${requirement.codes} codigos produtivos validos e exclusivos.`);
  }

  const deviceIds = new Set();
  for (const [index, device] of devices.entries()) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(device.device_id || '')) {
      fail(`Fixture invalida: device_id UUID ausente/invalido no indice ${index}.`);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(device.operator_session_id || '')) {
      fail(`Fixture invalida: operator_session_id UUID ausente/invalido no indice ${index}.`);
    }
    if (!(device.access_token || fixture.access_token)) {
      fail(`Fixture invalida: access_token ausente no indice ${index}.`);
    }
    if (deviceIds.has(device.device_id)) {
      fail(`Fixture invalida: device_id repetido no indice ${index}.`);
    }
    deviceIds.add(device.device_id);
  }

  const invalidCode = codes.find((code) => !/^\d{8}$/.test(code));
  if (invalidCode) fail('Fixture invalida: todos os codigos devem conter exatamente oito digitos.');
  if (new Set(codes).size !== codes.length) {
    fail('Fixture invalida: os codigos produtivos devem ser exclusivos nesta rodada.');
  }

  if (profile === 'contention_piece' || profile === 'contention_cell_lot') {
    const expected = fixture.contention || {};
    if (!/^[0-9a-f-]{36}$/i.test(expected.lot_id || '') || !expected.cell_name) {
      fail('Fixture de contencao exige contention.lot_id e contention.cell_name.');
    }
    const requiredDevices = devices.slice(0, requirement.devices);
    const machines = requiredDevices.map((device) => device.machine_id).filter(Boolean);
    if (machines.length !== requirement.devices || new Set(machines).size !== requirement.devices) {
      fail('Perfil de contencao exige uma machine_id distinta por dispositivo.');
    }
  }
}

export function setup() {
  validateFixture();
  const health = fetchHealth(devices[0]);
  if (!health) fail('Health v3 indisponivel antes da carga.');

  const requiredFlags = [
    'collection_pipeline_v3_ingress',
    'collection_pipeline_v3_worker',
    'collection_pipeline_v3_projection',
  ];
  if (__ENV.K6_REQUIRE_BROADCAST !== '0') {
    requiredFlags.push('collection_pipeline_v3_broadcast');
  }
  const disabled = requiredFlags.filter((name) => health.flags?.[name]?.enabled !== true);
  if (disabled.length > 0) {
    fail(`Flags v3 obrigatorias desligadas: ${disabled.join(', ')}.`);
  }
  if (health.structural_ready !== true || health.ready !== true) {
    fail('Health v3 nao esta ready antes da carga; corrija a causa em vez de relaxar limites.');
  }
  if ((health.counts?.dlq_messages || 0) !== 0) {
    fail('DLQ deve estar vazia no staging isolado antes da carga.');
  }

  return {
    started_at: new Date().toISOString(),
    contention_launch_at: Date.now() + 5000,
  };
}

export function smoke() {
  submitBatch('smoke', 'live', 1);
}

export function nominal() {
  submitBatch('nominal', 'live', 1);
}

export function connectedDevice() {
  const deviceIndex = (Number(execution.vu.idInTest) - 1) % 100;
  const device = devices[deviceIndex];
  const topic = `realtime:collection:device:${device.device_id}`;
  const joinedAt = Date.now();
  let joined = false;
  let failed = false;
  let finalizedMessages = 0;
  let heartbeatRef = 2;

  const response = ws.connect(
    realtimeUrl(),
    { tags: { operation: 'realtime_private_device', profile, device_slot: String(deviceIndex) } },
    (socket) => {
      socket.on('open', () => {
        socket.send(JSON.stringify({
          topic,
          event: 'phx_join',
          payload: {
            config: {
              broadcast: { ack: false, self: false },
              presence: { key: '', enabled: false },
              postgres_changes: [],
              private: true,
            },
            access_token: device.access_token || fixture.access_token,
          },
          ref: '1',
          join_ref: '1',
        }));
      });

      socket.on('message', (rawMessage) => {
        const message = decodeRealtimeMessage(rawMessage);
        if (
          message?.event === 'phx_reply'
          && message.ref === '1'
          && message.payload?.status === 'ok'
        ) {
          joined = true;
          realtimeJoinMs.add(Date.now() - joinedAt, { device_slot: String(deviceIndex) });
        }
        if (
          message?.event === 'broadcast'
          && message.payload?.event === 'collection.finalized'
        ) {
          finalizedMessages += 1;
        }
      });

      socket.on('error', () => {
        if (!failed) realtimeConnectionFailures.add(1, { device_slot: String(deviceIndex) });
        failed = true;
      });

      socket.on('close', () => {
        if (Date.now() - joinedAt < 600000 && !failed) {
          realtimeConnectionFailures.add(1, { device_slot: String(deviceIndex) });
          failed = true;
        }
      });

      socket.setInterval(() => {
        socket.send(JSON.stringify({
          topic: 'phoenix',
          event: 'heartbeat',
          payload: {},
          ref: String(heartbeatRef),
        }));
        heartbeatRef += 1;
      }, 25000);

      socket.setTimeout(() => {
        if (!joined) {
          if (!failed) realtimeConnectionFailures.add(1, { device_slot: String(deviceIndex) });
          failed = true;
          socket.close();
        }
      }, 5000);

      socket.setTimeout(() => socket.close(), 605000);
    },
  );

  if (response?.status !== 101 && !failed) {
    realtimeConnectionFailures.add(1, { device_slot: String(deviceIndex) });
    failed = true;
  }
  if (joined && finalizedMessages === 0) {
    realtimeDevicesWithoutFinalized.add(1, { device_slot: String(deviceIndex) });
  }
  check(response, {
    'canal privado do dispositivo conectou': () => response?.status === 101 && joined && !failed,
    'dispositivo recebeu ao menos uma decisao final': () => finalizedMessages > 0,
  });
}

export function burst() {
  submitBatch('burst', 'live', 1);
}

export function microbatch() {
  submitBatch('microbatch', 'live', 25);
}

export function priorityReplaySeed() {
  submitBatch('priority_replay_seed', 'offline_replay', 25);
}

export function priorityLive() {
  submitBatch('priority_live', 'live', 1);
}

export function priorityReplay() {
  submitBatch('priority_replay', 'offline_replay', 1);
}

export function idempotency() {
  const iteration = iterationNumber();
  const device = selectDevice(iteration);
  const events = createEvents('idempotency', 'live', 1, iteration);
  const event = events[0];
  const batchId = deterministicUuid(`${runId}:idempotency:batch:${iteration}`);
  let firstReceipt = null;

  for (let delivery = 0; delivery < 5; delivery += 1) {
    const response = rpc(
      'ingest_collection_batch_v3',
      {
        p_batch_id: batchId,
        p_device_id: device.device_id,
        p_events: {
          operator_session_id: device.operator_session_id,
          source_mode: 'live',
          app_version: `k6-${runId}`,
          events,
        },
      },
      device,
      { source_mode: 'live', workload: 'idempotency', delivery: String(delivery + 1) },
    );
    ackMs.add(response.timings.duration, { source_mode: 'live', workload: 'idempotency' });
    const result = jsonResponse(response)?.results?.[0];
    const valid = response.status === 200
      && result?.persisted === true
      && result.client_event_id === event.client_event_id
      && !result.error_code;
    if (!valid) {
      ingressFailures.add(1, { workload: 'idempotency' });
      persistenceFailures.add(1, { workload: 'idempotency' });
    }

    if (delivery === 0) {
      firstReceipt = result;
      if (result?.duplicate_receipt === true) idempotencyViolations.add(1);
    } else if (result?.duplicate_receipt !== true) {
      idempotencyViolations.add(1);
    }

    check(response, {
      'reentrega idempotente responde 200': () => response.status === 200,
      'reentrega preserva client_event_id': () => result?.client_event_id === event.client_event_id,
      'reentrega permanece persistida': () => result?.persisted === true && !result?.error_code,
    });
  }

  const receiptResponse = http.get(receiptUrl([event.client_event_id]), {
    headers: { ...authHeaders(device), Prefer: 'count=exact' },
    tags: { operation: 'verify_idempotent_receipt', profile, workload: 'idempotency' },
  });
  const receipts = jsonResponse(receiptResponse);
  if (receiptResponse.status !== 200 || !Array.isArray(receipts) || receipts.length !== 1 || !firstReceipt) {
    idempotencyViolations.add(1);
  }
  check(receiptResponse, {
    'existe exatamente um recibo para o client_event_id': () => (
      receiptResponse.status === 200 && Array.isArray(receipts) && receipts.length === 1
    ),
  });

  observeEvents(device, events, 'live', 'idempotency');

  const ledgerResponse = http.get(ledgerUrl(event.client_event_id), {
    headers: { ...authHeaders(device), Prefer: 'count=exact' },
    tags: { operation: 'verify_idempotent_ledger', profile, workload: 'idempotency' },
  });
  const ledgerRows = jsonResponse(ledgerResponse);
  if (ledgerResponse.status !== 200 || !Array.isArray(ledgerRows) || ledgerRows.length !== 1) {
    idempotencyViolations.add(1);
  }
  check(ledgerResponse, {
    'existe exatamente um fato canonico para o client_event_id': () => (
      ledgerResponse.status === 200 && Array.isArray(ledgerRows) && ledgerRows.length === 1
    ),
  });
}

export function contentionSamePiece(setupData) {
  const row = submitContentionEvent('contention_piece', codes[0], setupData);
  if (!row) return;

  contentionPieceOutcomes.add(1);
  if (row.status === 'approved') {
    contentionPieceApprovals.add(1);
  } else if (row.status === 'blocked' || row.status === 'duplicated') {
    contentionPieceBlockedOrDuplicated.add(1);
  }
  check(row, {
    'mesma peca termina aprovada bloqueada ou duplicada': (value) => (
      ['approved', 'blocked', 'duplicated'].includes(value.status)
    ),
  });
}

export function contentionSameCellLot(setupData) {
  const vuIndex = Number(execution.vu.idInTest) - 1;
  const row = submitContentionEvent(
    'contention_cell_lot',
    codes[vuIndex],
    setupData,
  );
  if (!row) return;

  contentionCellLotOutcomes.add(1);
  if (row.status === 'approved') contentionCellLotApprovals.add(1);
  check(row, {
    'peca distinta na mesma celula e lote foi aprovada': (value) => value.status === 'approved',
  });
}

export function teardown() {
  const device = devices[0];
  const drainDeadline = Date.now() + Number(__ENV.K6_DRAIN_TIMEOUT_MS || 30000);
  let health = null;

  do {
    health = fetchHealth(device);
    if (
      health
      && Number(health.queues?.decision_length || 0) === 0
      && Number(health.queues?.projection_length || 0) === 0
    ) break;
    sleep(0.5);
  } while (Date.now() < drainDeadline);

  if (!health) {
    finalHealthFailures.add(1);
    return;
  }

  const deadlocks = Number(health.database_failures?.deadlocks || 0);
  const statementTimeouts = Number(health.database_failures?.statement_timeouts || 0);
  const dlqMessages = Number(health.counts?.dlq_messages || 0);
  if (deadlocks > 0) serverDeadlocks.add(deadlocks);
  if (statementTimeouts > 0) serverStatementTimeouts.add(statementTimeouts);
  if (dlqMessages > 0) serverDlqMessages.add(dlqMessages);

  serverProcessingP95Ms.add(Number(health.latency_ms?.processing?.p95 || 0));
  serverProcessingP99Ms.add(Number(health.latency_ms?.processing?.p99 || 0));
  serverProjectionP95Ms.add(Number(health.latency_ms?.projection?.p95 || 0));
  serverQueueP99Ms.add(Number(health.queues?.age_seconds?.p99 || 0) * 1000);
  serverRetryRate.add(Number(health.rates?.retry || 0));

  if (
    health.ready !== true
    || Number(health.queues?.decision_length || 0) !== 0
    || Number(health.queues?.projection_length || 0) !== 0
  ) {
    finalHealthFailures.add(1);
  }

  check(health, {
    'health final ready': (result) => result.ready === true,
    'filas drenadas ao final': (result) => (
      Number(result.queues?.decision_length || 0) === 0
      && Number(result.queues?.projection_length || 0) === 0
    ),
    'sem deadlock ou statement timeout': (result) => (
      Number(result.database_failures?.deadlocks || 0) === 0
      && Number(result.database_failures?.statement_timeouts || 0) === 0
    ),
    'DLQ vazia': (result) => Number(result.counts?.dlq_messages || 0) === 0,
  });
}
