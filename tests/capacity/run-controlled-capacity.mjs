import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { CAPACITY_PROFILE_REQUIREMENTS } from '../../src/lib/capacityTestControl.js';

const RUN_ID_PATTERN = /^CAPTEST_[0-9]{8}_[0-9]{6}_[A-Z0-9]{8}$/;
const EXECUTOR_ID_PATTERN = /^[a-zA-Z0-9:_-]{1,160}$/;
const ALLOWED_PROFILES = new Set([
  'smoke',
  'idempotency',
  'microbatch',
  'priority',
  'contention_piece',
  'contention_cell_lot',
  'atomic8',
  'nominal',
  'burst',
]);
const POLL_MS = 250;
const CONTROL_RPC_TIMEOUT_MS = 500;
const DEFAULT_RPC_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 2_000;
const CONTROL_PLANE_GRACE_MS = 2_000;
const TERMINATION_GRACE_MS = 2_000;
const TEST_PRODUCTION_URL = 'https://uozuzdfvnufsjsonswag.supabase.co';
const TEST_PRODUCTION_CONFIRMATION =
  'EU-AUTORIZO-ESCRITAS-K6-DESTRUTIVAS-NO-ACPROD-TESTE-uozuzdfvnufsjsonswag';
const SAFE_K6_ENVIRONMENT_KEYS = Object.freeze([
  'PATH',
  'LANG',
  'LC_ALL',
  'TMPDIR',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'K6_TARGET',
  'K6_CONFIRM_WRITES',
  'K6_FIXTURES',
  'K6_PROFILE',
  'K6_SEQUENCE_BASE',
  'K6_ATTEMPT',
  'K6_HTTP_TIMEOUT',
]);

function normalizedRpcRow(value) {
  return Array.isArray(value) ? value[0] : value;
}

function safeErrorCode(value) {
  const code = String(value || 'REQUEST_FAILED').toUpperCase();
  return /^[A-Z0-9_:-]{1,100}$/.test(code) ? code : 'REQUEST_FAILED';
}

export function extractServiceRoleKey(input) {
  const indexes = ['[', '{']
    .map((char) => input.indexOf(char))
    .filter((index) => index >= 0);
  if (indexes.length === 0) throw new Error('SERVICE_KEY_JSON_REQUIRED');
  const payload = JSON.parse(input.slice(Math.min(...indexes)));
  const keys = Array.isArray(payload) ? payload : payload?.keys || [];
  const entry = keys.find((item) => item.name === 'service_role' || item.role === 'service_role')
    || keys.find((item) => item.type === 'secret' || String(item.api_key || '').startsWith('sb_secret_'));
  const key = String(entry?.api_key || '');
  if (!key) throw new Error('SERVICE_ROLE_KEY_NOT_FOUND');
  return key;
}

export function parseExecutorArgs(argv) {
  const args = {
    runId: '',
    summaryExport: '',
    k6Bin: 'k6',
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--run-id') {
      args.runId = argv[++index] || '';
    } else if (arg === '--summary-export') {
      args.summaryExport = argv[++index] || '';
    } else if (arg === '--k6-bin') {
      args.k6Bin = argv[++index] || '';
    } else {
      throw new Error(`UNKNOWN_ARGUMENT:${arg}`);
    }
  }
  if (!RUN_ID_PATTERN.test(args.runId)) throw new Error('RUN_ID_INVALID');
  if (!args.summaryExport) throw new Error('SUMMARY_EXPORT_REQUIRED');
  if (!args.k6Bin) throw new Error('K6_BINARY_REQUIRED');
  args.summaryExport = resolve(args.summaryExport);
  return args;
}

export function validateEnvironmentPlan(env, runConfig = null) {
  const supabaseUrl = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const profile = String(env.K6_PROFILE || '').toLowerCase();
  const target = String(env.K6_TARGET || '');
  const sequenceBase = Number(env.K6_SEQUENCE_BASE);
  const codeOffset = Number(env.K6_CODE_OFFSET || 0);
  const fixturePath = resolve(String(env.K6_FIXTURES || ''));
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabaseUrl)) {
    throw new Error('SUPABASE_URL_INVALID');
  }
  if (!env.SUPABASE_ANON_KEY) throw new Error('SUPABASE_ANON_KEY_REQUIRED');
  if (!ALLOWED_PROFILES.has(profile)) throw new Error('K6_PROFILE_INVALID');
  if (!['staging', 'test-production'].includes(target)) throw new Error('K6_TARGET_INVALID');
  if (target === 'staging') {
    if (env.K6_CONFIRM_WRITES !== 'staging-v3-load') throw new Error('STAGING_CONFIRMATION_INVALID');
    if (supabaseUrl === TEST_PRODUCTION_URL) throw new Error('STAGING_TARGETS_TEST_PRODUCTION');
  } else if (
    supabaseUrl !== TEST_PRODUCTION_URL
    || env.K6_CONFIRM_WRITES !== TEST_PRODUCTION_CONFIRMATION
  ) {
    throw new Error('TEST_PRODUCTION_CONFIRMATION_INVALID');
  }
  if (!Number.isSafeInteger(sequenceBase) || sequenceBase < 1) {
    throw new Error('K6_SEQUENCE_BASE_INVALID');
  }
  if (!Number.isSafeInteger(codeOffset) || codeOffset !== 0) {
    throw new Error('K6_CODE_OFFSET_UNSUPPORTED');
  }
  if (!env.K6_FIXTURES) throw new Error('K6_FIXTURES_REQUIRED');

  if (runConfig) {
    if (runConfig.profile !== profile) throw new Error('RUN_PROFILE_MISMATCH');
    if (runConfig.target !== target) throw new Error('RUN_TARGET_MISMATCH');
    if (Number(runConfig.sequence_base) !== sequenceBase) {
      throw new Error('RUN_SEQUENCE_BASE_MISMATCH');
    }
    const requirements = CAPACITY_PROFILE_REQUIREMENTS[profile];
    for (const [key, expected] of Object.entries(requirements)) {
      if (Number(runConfig[key]) !== expected) {
        throw new Error(`RUN_${key.toUpperCase()}_MISMATCH`);
      }
    }
  }
  return { fixturePath, profile, sequenceBase, supabaseUrl, target };
}

export async function validateCapacityFixture(fixturePath, runId, profile) {
  let fixture;
  try {
    fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  } catch {
    throw new Error('CAPACITY_FIXTURE_UNREADABLE');
  }
  const requirement = CAPACITY_PROFILE_REQUIREMENTS[profile];
  const devices = Array.isArray(fixture.devices) ? fixture.devices : [];
  const atomicDevices = Array.isArray(fixture.atomic_devices) ? fixture.atomic_devices : [];
  const codes = Array.isArray(fixture.codes) ? fixture.codes.map(String) : [];
  if (fixture.run_id !== runId) throw new Error('CAPACITY_FIXTURE_RUN_MISMATCH');
  if (fixture.profile !== profile) throw new Error('CAPACITY_FIXTURE_PROFILE_MISMATCH');
  if (devices.length < requirement.devices || codes.length < requirement.pieces) {
    throw new Error('CAPACITY_FIXTURE_SIZE_MISMATCH');
  }
  const selectedDevices = profile === 'atomic8' ? atomicDevices : devices;
  const selected = selectedDevices.slice(0, requirement.devices);
  if (selected.length !== requirement.devices
      || selected.some((device) => !device?.device_id
        || !device?.operator_session_id
        || !device?.access_token
        || !device?.cell_id
        || !device?.machine_id)
      || new Set(selected.map((device) => device.device_id)).size !== selected.length
      || new Set(selected.map((device) => device.operator_session_id)).size !== selected.length) {
    throw new Error('CAPACITY_FIXTURE_DEVICE_IDENTITY_INVALID');
  }
  if (codes.some((code) => !/^\d{8}$/.test(code)) || new Set(codes).size !== codes.length) {
    throw new Error('CAPACITY_FIXTURE_CODES_INVALID');
  }
  if (profile === 'atomic8') {
    if (new Set(selected.map((device) => device.machine_id)).size !== 1) {
      throw new Error('CAPACITY_FIXTURE_ATOMIC_CONTEXT_INVALID');
    }
  } else if (profile === 'contention_piece' || profile === 'contention_cell_lot') {
    if (new Set(selected.map((device) => device.machine_id)).size !== selected.length) {
      throw new Error('CAPACITY_FIXTURE_CONTENTION_CONTEXT_INVALID');
    }
  }
  return { codes: codes.length, devices: selected.length };
}

export function applyControlStatus(status, state, sendSignal) {
  if (status === 'paused') {
    if (!state.paused && !state.stopOutcome) {
      if (!sendSignal('SIGSTOP')) throw new Error('K6_PAUSE_SIGNAL_FAILED');
      state.paused = true;
    }
    return state;
  }

  if (status === 'running') {
    if (state.paused && !state.stopOutcome) {
      if (!sendSignal('SIGCONT')) throw new Error('K6_RESUME_SIGNAL_FAILED');
      state.paused = false;
    }
    return state;
  }

  const requestedOutcome = status === 'emergency_stopped'
    ? 'emergency_stopped'
    : (['cancel_requested', 'cancelled'].includes(status) ? 'cancelled' : null);
  if (requestedOutcome && !state.stopOutcome) {
    if (state.paused) {
      sendSignal('SIGCONT');
      state.paused = false;
    }
    sendSignal('SIGTERM');
    state.stopOutcome = requestedOutcome;
    state.stopReason = requestedOutcome === 'emergency_stopped'
      ? 'operator_emergency_stop'
      : 'operator_cancel';
    state.stopStartedAt = Date.now();
  }
  if (!requestedOutcome && !['running', 'paused'].includes(status) && !state.stopOutcome) {
    if (state.paused) sendSignal('SIGCONT');
    sendSignal('SIGTERM');
    state.paused = false;
    state.stopOutcome = 'failed';
    state.stopReason = 'unexpected_control_status';
    state.stopStartedAt = Date.now();
  }
  return state;
}

export function summarizeK6Result(summary) {
  const breaches = [];
  const strictSlos = [
    ['collection_ingress_ack_ms', 'p(95)', 250],
    ['collection_decision_ms', 'p(95)', 800],
    ['collection_decision_ms', 'p(99)', 2_000],
    ['collection_projection_ms', 'p(95)', 500],
    ['collection_queue_age_ms', 'p(99)', 2_000],
  ];
  const requiredThresholds = [
    ['checks', 'rate==1'],
    ['collection_ingress_ack_ms', 'p(95)<250'],
    ['collection_decision_ms', 'p(95)<800'],
    ['collection_decision_ms', 'p(99)<2000'],
    ['collection_projection_ms', 'p(95)<500'],
    ['collection_queue_age_ms', 'p(99)<2000'],
  ];
  if (!summary?.metrics) breaches.push('summary:missing');
  for (const [metricName, expression] of requiredThresholds) {
    const result = summary?.metrics?.[metricName]?.thresholds?.[expression];
    if (result === undefined) breaches.push(`${metricName}:${expression}:missing`);
  }
  for (const [metricName, metric] of Object.entries(summary?.metrics || {})) {
    for (const [threshold, result] of Object.entries(metric?.thresholds || {})) {
      const passed = typeof result === 'boolean' ? result : result?.ok;
      if (passed !== true) breaches.push(`${metricName}:${threshold}`);
    }
  }
  for (const [metricName, stat, limit] of strictSlos) {
    const metric = summary?.metrics?.[metricName];
    const value = Number(metric?.values?.[stat] ?? metric?.[stat]);
    if (!Number.isFinite(value)) breaches.push(`${metricName}:${stat}:missing`);
    else if (value >= limit) breaches.push(`${metricName}:${stat}:${value}>=${limit}`);
  }
  return {
    threshold_breaches: breaches.slice(0, 100),
    thresholds_passed: breaches.length === 0,
    slo: {
      ack_p95_ms: summary?.metrics?.collection_ingress_ack_ms?.values?.['p(95)']
        ?? summary?.metrics?.collection_ingress_ack_ms?.['p(95)'] ?? null,
      ack_blocked_p95_ms: summary?.metrics?.collection_ingress_ack_blocked_ms?.values?.['p(95)']
        ?? summary?.metrics?.collection_ingress_ack_blocked_ms?.['p(95)'] ?? null,
      ack_connecting_p95_ms: summary?.metrics?.collection_ingress_ack_connecting_ms?.values?.['p(95)']
        ?? summary?.metrics?.collection_ingress_ack_connecting_ms?.['p(95)'] ?? null,
      ack_tls_p95_ms: summary?.metrics?.collection_ingress_ack_tls_ms?.values?.['p(95)']
        ?? summary?.metrics?.collection_ingress_ack_tls_ms?.['p(95)'] ?? null,
      ack_waiting_p95_ms: summary?.metrics?.collection_ingress_ack_waiting_ms?.values?.['p(95)']
        ?? summary?.metrics?.collection_ingress_ack_waiting_ms?.['p(95)'] ?? null,
      decision_p95_ms: summary?.metrics?.collection_decision_ms?.values?.['p(95)']
        ?? summary?.metrics?.collection_decision_ms?.['p(95)'] ?? null,
      decision_p99_ms: summary?.metrics?.collection_decision_ms?.values?.['p(99)']
        ?? summary?.metrics?.collection_decision_ms?.['p(99)'] ?? null,
      projection_p95_ms: summary?.metrics?.collection_projection_ms?.values?.['p(95)']
        ?? summary?.metrics?.collection_projection_ms?.['p(95)'] ?? null,
      queue_p99_ms: summary?.metrics?.collection_queue_age_ms?.values?.['p(99)']
        ?? summary?.metrics?.collection_queue_age_ms?.['p(99)'] ?? null,
    },
  };
}

function createRpcClient(supabaseUrl, serviceKey, fetchImpl = fetch) {
  return async (functionName, body, { timeoutMs = DEFAULT_RPC_TIMEOUT_MS } = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(`RPC_${functionName.toUpperCase()}_HTTP_${response.status}:${safeErrorCode(data?.code)}`);
      }
      return normalizedRpcRow(data);
    } finally {
      clearTimeout(timeout);
    }
  };
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function waitForK6Version(k6Bin) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(k6Bin, ['version'], { stdio: 'ignore' });
    child.once('error', () => rejectPromise(new Error('K6_BINARY_UNAVAILABLE')));
    child.once('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error('K6_VERSION_CHECK_FAILED'));
    });
  });
}

function childEnvironment(env, runId) {
  const safeEnvironment = { K6_RUN_ID: runId };
  for (const key of SAFE_K6_ENVIRONMENT_KEYS) {
    if (env[key] !== undefined) safeEnvironment[key] = env[key];
  }
  return safeEnvironment;
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function readSummary(summaryPath) {
  try {
    const raw = await readFile(summaryPath);
    return {
      hash: createHash('sha256').update(raw).digest('hex'),
      summary: JSON.parse(raw.toString('utf8')),
    };
  } catch {
    return { hash: null, summary: null };
  }
}

export async function runControlledCapacity({
  args,
  env = process.env,
  serviceKey,
  fetchImpl = fetch,
  spawnImpl = spawn,
  verifyK6 = waitForK6Version,
}) {
  if (process.platform === 'win32') throw new Error('CONTROLLED_EXECUTOR_REQUIRES_POSIX_SIGNALS');
  const plan = validateEnvironmentPlan(env);
  await access(plan.fixturePath, fsConstants.R_OK);
  await validateCapacityFixture(plan.fixturePath, args.runId, plan.profile);
  await mkdir(dirname(args.summaryExport), { recursive: true });
  await verifyK6(args.k6Bin);

  const rpc = createRpcClient(plan.supabaseUrl, serviceKey, fetchImpl);
  const requestedRun = await rpc('inspect_capacity_test_run_v3', { p_run_id: args.runId });
  if (requestedRun?.status !== 'requested') throw new Error('CAPACITY_RUN_NOT_REQUESTED');
  validateEnvironmentPlan(env, requestedRun.config || {});

  // A stopped/failed k6 must never inherit evidence from an older invocation.
  // Do this before claiming the database run so an unwritable artifact path
  // cannot strand the control record in running state.
  await rm(args.summaryExport, { force: true });
  await rm(`${args.summaryExport}.control.json`, { force: true });

  const executorId = `capacity:${randomUUID()}`;
  if (!EXECUTOR_ID_PATTERN.test(executorId)) throw new Error('EXECUTOR_ID_INVALID');
  const claimedRun = await rpc('claim_capacity_test_run_v3', {
    p_run_id: args.runId,
    p_executor_id: executorId,
  });
  if (claimedRun?.status !== 'running') throw new Error('CAPACITY_RUN_CLAIM_FAILED');

  const child = spawnImpl(
    args.k6Bin,
    [
      'run',
      '--summary-export',
      args.summaryExport,
      resolve('tests/load/collection-fabric-v3.js'),
    ],
    {
      cwd: process.cwd(),
      env: childEnvironment(env, args.runId),
      stdio: 'inherit',
    },
  );

  const state = {
    paused: false,
    stopOutcome: null,
    stopReason: null,
    stopStartedAt: 0,
  };
  let externalStop = null;
  let childResult = null;
  let lastControlSuccess = Date.now();
  let lastHeartbeat = 0;
  let lastRevision = Number(claimedRun.control_revision || 0);
  const childExited = new Promise((resolvePromise) => {
    child.once('error', (error) => resolvePromise({ code: null, signal: null, error }));
    child.once('exit', (code, signal) => resolvePromise({ code, signal, error: null }));
  }).then((result) => {
    childResult = result;
    return result;
  });

  const requestExternalStop = (signal) => {
    externalStop = signal;
    if (!state.stopOutcome) {
      if (state.paused) child.kill('SIGCONT');
      child.kill('SIGTERM');
      state.paused = false;
      state.stopOutcome = 'failed';
      state.stopReason = `executor_received_${signal}`;
      state.stopStartedAt = Date.now();
    }
  };
  const signalHandlers = new Map([
    ['SIGINT', () => requestExternalStop('SIGINT')],
    ['SIGTERM', () => requestExternalStop('SIGTERM')],
  ]);
  for (const [signal, handler] of signalHandlers) process.once(signal, handler);

  try {
    while (!childResult) {
      let control = null;
      try {
        const now = Date.now();
        const touchHeartbeat = now - lastHeartbeat >= HEARTBEAT_MS;
        control = await rpc('observe_capacity_test_run_v3', {
          p_run_id: args.runId,
          p_executor_id: executorId,
          p_touch_heartbeat: touchHeartbeat,
        }, { timeoutMs: CONTROL_RPC_TIMEOUT_MS });
        if (!control?.status) throw new Error('CONTROL_RESPONSE_INVALID');
        if (touchHeartbeat) lastHeartbeat = now;
        lastControlSuccess = now;
        lastRevision = Number(control?.control_revision || lastRevision);
      } catch {
        if (Date.now() - lastControlSuccess >= CONTROL_PLANE_GRACE_MS && !state.stopOutcome) {
          if (state.paused) child.kill('SIGCONT');
          child.kill('SIGTERM');
          state.paused = false;
          state.stopOutcome = 'failed';
          state.stopReason = 'control_plane_unreachable';
          state.stopStartedAt = Date.now();
        }
      }

      if (control && !state.stopOutcome) {
        try {
          applyControlStatus(control.status, state, (signal) => child.kill(signal));
        } catch {
          if (state.paused) child.kill('SIGCONT');
          child.kill('SIGTERM');
          state.paused = false;
          state.stopOutcome = 'failed';
          state.stopReason = 'control_signal_failed';
          state.stopStartedAt = Date.now();
        }
      }

      if (state.stopOutcome && Date.now() - state.stopStartedAt >= TERMINATION_GRACE_MS) {
        child.kill('SIGKILL');
      }
      await Promise.race([childExited, delay(POLL_MS)]);
    }
  } finally {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
  }

  const { code, signal, error: childError } = await childExited;
  const resultFile = await readSummary(args.summaryExport);
  const k6Result = summarizeK6Result(resultFile.summary);
  let outcome = state.stopOutcome
    || (code === 0 && k6Result.thresholds_passed ? 'completed' : 'failed');
  if (!['completed', 'failed', 'cancelled', 'emergency_stopped'].includes(outcome)) {
    outcome = 'failed';
  }
  let reason = state.stopReason
    || (externalStop
      ? `executor_received_${externalStop}`
      : (childError ? 'k6_spawn_error' : (signal ? `k6_signal_${signal}` : `k6_exit_${code}`)));
  const metrics = {
    profile: plan.profile,
    target: plan.target,
    sequence_base: plan.sequenceBase,
    k6_exit_code: code,
    k6_signal: signal,
    summary_file: basename(args.summaryExport),
    summary_sha256: resultFile.hash,
    control_revision_seen: lastRevision,
    ...k6Result,
  };
  let artifactWriteFailed = false;
  try {
    await writeFile(`${args.summaryExport}.control.json`, `${JSON.stringify({
      run_id: args.runId,
      outcome,
      reason,
      metrics,
    }, null, 2)}\n`, { mode: 0o600 });
  } catch {
    artifactWriteFailed = true;
    outcome = 'failed';
    reason = 'control_artifact_write_failed';
    metrics.thresholds_passed = false;
    metrics.threshold_breaches = [
      ...metrics.threshold_breaches,
      'control_artifact:write_failed',
    ].slice(0, 100);
  }
  await rpc('finish_capacity_test_run_v3', {
    p_run_id: args.runId,
    p_executor_id: executorId,
    p_outcome: outcome,
    p_metrics: metrics,
    p_reason: reason,
  });
  if (artifactWriteFailed) throw new Error('CONTROL_ARTIFACT_WRITE_FAILED');
  return { outcome, reason, metrics };
}

async function main() {
  const args = parseExecutorArgs(process.argv.slice(2));
  const plan = validateEnvironmentPlan(process.env);
  await access(plan.fixturePath, fsConstants.R_OK);
  if (args.dryRun) {
    await validateCapacityFixture(plan.fixturePath, args.runId, plan.profile);
    await waitForK6Version(args.k6Bin);
    process.stdout.write(`${JSON.stringify({
      ready: true,
      run_id: args.runId,
      profile: plan.profile,
      target: plan.target,
      sequence_base: plan.sequenceBase,
      summary_file: basename(args.summaryExport),
    })}\n`);
    return;
  }
  const serviceKey = extractServiceRoleKey(await readStdin());
  const result = await runControlledCapacity({ args, serviceKey });
  process.stdout.write(`${JSON.stringify({
    run_id: args.runId,
    outcome: result.outcome,
    thresholds_passed: result.metrics.thresholds_passed,
  })}\n`);
  if (result.outcome !== 'completed') process.exitCode = 2;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${safeErrorCode(error?.message)}\n`);
    process.exitCode = 1;
  });
}
