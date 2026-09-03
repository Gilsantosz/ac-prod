import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  applyControlStatus,
  extractServiceRoleKey,
  parseExecutorArgs,
  runControlledCapacity,
  summarizeK6Result,
  validateEnvironmentPlan,
} from '../../../tests/capacity/run-controlled-capacity.mjs';

describe('controlled capacity executor', () => {
  it('extracts the server key from piped CLI JSON without putting it on argv', () => {
    expect(extractServiceRoleKey(JSON.stringify([
      { name: 'anon', api_key: 'public-value' },
      { name: 'service_role', api_key: 'server-value' },
    ]))).toBe('server-value');
    expect(() => parseExecutorArgs([
      '--run-id', 'CAPTEST_20260903_120000_ABCDEF12',
      '--summary-export', 'artifacts/result.json',
      '--unknown', 'value',
    ])).toThrow('UNKNOWN_ARGUMENT');
  });

  it('refuses a local plan that differs from the audited database config', () => {
    const env = {
      SUPABASE_URL: 'https://staging123.supabase.co',
      SUPABASE_ANON_KEY: 'public-value',
      K6_PROFILE: 'smoke',
      K6_TARGET: 'staging',
      K6_CONFIRM_WRITES: 'staging-v3-load',
      K6_SEQUENCE_BASE: '180000000',
      K6_FIXTURES: '/tmp/protected-fixture.json',
    };
    expect(validateEnvironmentPlan(env, {
      profile: 'smoke', target: 'staging', sequence_base: 180000000,
      devices: 1, pieces: 1, duration_minutes: 1,
    })).toMatchObject({ profile: 'smoke', target: 'staging', sequenceBase: 180000000 });
    expect(() => validateEnvironmentPlan(env, {
      profile: 'burst', target: 'staging', sequence_base: 180000000,
    })).toThrow('RUN_PROFILE_MISMATCH');
  });

  it('pauses, resumes and terminates k6 when the control record changes', () => {
    const sendSignal = vi.fn(() => true);
    const state = { paused: false, stopOutcome: null, stopStartedAt: 0 };

    applyControlStatus('paused', state, sendSignal);
    applyControlStatus('running', state, sendSignal);
    applyControlStatus('emergency_stopped', state, sendSignal);

    expect(sendSignal.mock.calls.map(([signal]) => signal)).toEqual([
      'SIGSTOP', 'SIGCONT', 'SIGTERM',
    ]);
    expect(state.stopOutcome).toBe('emergency_stopped');
  });

  it('fails a pause immediately when the process rejects the signal', () => {
    const state = { paused: false, stopOutcome: null, stopStartedAt: 0 };
    expect(() => applyControlStatus('paused', state, () => false))
      .toThrow('K6_PAUSE_SIGNAL_FAILED');
    expect(state.paused).toBe(false);
  });

  it('treats missing evidence or any k6 threshold breach as NO-GO evidence', () => {
    expect(summarizeK6Result(null).thresholds_passed).toBe(false);
    const result = summarizeK6Result({
      metrics: {
        checks: { thresholds: { 'rate==1': true } },
        collection_ingress_ack_ms: {
          values: { 'p(95)': 100 }, thresholds: { 'p(95)<250': { ok: true } },
        },
        collection_decision_ms: {
          values: { 'p(95)': 300, 'p(99)': 500 },
          thresholds: { 'p(95)<800': { ok: false }, 'p(99)<2000': { ok: true } },
        },
        collection_projection_ms: {
          values: { 'p(95)': 200 }, thresholds: { 'p(95)<500': { ok: true } },
        },
        collection_queue_age_ms: {
          values: { 'p(99)': 400 }, thresholds: { 'p(99)<2000': { ok: true } },
        },
      },
    });
    expect(result.thresholds_passed).toBe(false);
    expect(result.threshold_breaches).toContain('collection_decision_ms:p(95)<800');
  });

  it('polls the service-role control RPC and never passes that key to k6', () => {
    const source = readFileSync(resolve('tests/capacity/run-controlled-capacity.mjs'), 'utf8');
    expect(source).toContain("rpc('observe_capacity_test_run_v3'");
    expect(source).toContain('timeoutMs: CONTROL_RPC_TIMEOUT_MS');
    expect(source).toContain('signal: controller.signal');
    expect(source).toContain("child.kill('SIGKILL')");
    expect(source).toContain('const SAFE_K6_ENVIRONMENT_KEYS');
    expect(source).not.toContain('...env, K6_RUN_ID');
  });

  it('observes emergency-stop, terminates the live child and finalizes the run', async () => {
    const temp = await mkdtemp(resolve(tmpdir(), 'acprod-capacity-'));
    const fixturePath = resolve(temp, 'fixture.json');
    const summaryPath = resolve(temp, 'summary.json');
    await writeFile(fixturePath, '{}');
    const passingMetric = (values, threshold) => ({ ...values, thresholds: { [threshold]: true } });
    await writeFile(summaryPath, JSON.stringify({
      metrics: {
        checks: { thresholds: { 'rate==1': true } },
        collection_ingress_ack_ms: passingMetric({ 'p(95)': 100 }, 'p(95)<250'),
        collection_decision_ms: {
          'p(95)': 300, 'p(99)': 500, thresholds: { 'p(95)<800': true, 'p(99)<2000': true },
        },
        collection_projection_ms: passingMetric({ 'p(95)': 200 }, 'p(95)<500'),
        collection_queue_age_ms: passingMetric({ 'p(99)': 400 }, 'p(99)<2000'),
      },
    }));

    const signals = [];
    const child = new EventEmitter();
    child.kill = vi.fn((signal) => {
      signals.push(signal);
      if (signal === 'SIGTERM') queueMicrotask(() => child.emit('exit', null, 'SIGTERM'));
      return true;
    });
    const finishedBodies = [];
    const fetchImpl = vi.fn(async (url, options) => {
      const rpc = url.split('/').pop();
      const body = JSON.parse(options.body);
      if (rpc === 'inspect_capacity_test_run_v3') {
        return new Response(JSON.stringify({
          status: 'requested',
          config: {
            profile: 'smoke', target: 'staging', sequence_base: 180000000,
            devices: 1, pieces: 1, duration_minutes: 1,
          },
        }));
      }
      if (rpc === 'claim_capacity_test_run_v3') {
        return new Response(JSON.stringify({ status: 'running', control_revision: 1 }));
      }
      if (rpc === 'observe_capacity_test_run_v3') {
        return new Response(JSON.stringify({ status: 'emergency_stopped', control_revision: 2 }));
      }
      if (rpc === 'finish_capacity_test_run_v3') {
        finishedBodies.push(body);
        return new Response(JSON.stringify({ status: 'emergency_stopped' }));
      }
      return new Response('{}', { status: 404 });
    });
    const env = {
      SUPABASE_URL: 'https://staging123.supabase.co',
      SUPABASE_ANON_KEY: 'public-value',
      K6_PROFILE: 'smoke',
      K6_TARGET: 'staging',
      K6_CONFIRM_WRITES: 'staging-v3-load',
      K6_SEQUENCE_BASE: '180000000',
      K6_FIXTURES: fixturePath,
      SUPABASE_SERVICE_ROLE_KEY: 'must-not-reach-k6',
    };
    const spawnImpl = vi.fn(() => child);

    try {
      const result = await runControlledCapacity({
        args: {
          runId: 'CAPTEST_20260903_120000_ABCDEF12',
          summaryExport: summaryPath,
          k6Bin: 'k6',
        },
        env,
        serviceKey: 'server-only-value',
        fetchImpl,
        spawnImpl,
        verifyK6: vi.fn(async () => {}),
      });

      expect(signals).toContain('SIGTERM');
      expect(spawnImpl.mock.calls[0][2].env).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
      expect(result.outcome).toBe('emergency_stopped');
      expect(finishedBodies[0]).toMatchObject({
        p_outcome: 'emergency_stopped',
        p_reason: 'operator_emergency_stop',
      });
      const sidecar = JSON.parse(await readFile(`${summaryPath}.control.json`, 'utf8'));
      expect(sidecar.outcome).toBe('emergency_stopped');
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
