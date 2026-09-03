import { describe, expect, it } from 'vitest';
import {
  evaluateCapacityGate,
  inspectSummaryArtifact,
  REQUIRED_CAPACITY_EVIDENCE,
  REQUIRED_CAPACITY_RUNS,
} from '../../../tests/capacity/evaluate-capacity-gate.mjs';

function passingManifest() {
  const runs = [];
  const controls = [];
  let ordinal = 1;
  for (const [profile, count] of Object.entries(REQUIRED_CAPACITY_RUNS)) {
    for (let index = 0; index < count; index += 1) {
      runs.push({ profile, control_file: `${profile}-${index}.control.json` });
      controls.push({
        run_id: `CAPTEST_20260903_120000_${String(ordinal).padStart(8, '0')}`,
        outcome: 'completed',
        metrics: {
          profile,
          target: 'staging',
          sequence_base: ordinal * 20_000_000,
          k6_exit_code: 0,
          k6_signal: null,
          summary_sha256: 'a'.repeat(64),
          thresholds_passed: true,
        },
        artifact: { sha256: 'a'.repeat(64), passed: true, reasons: [] },
      });
      ordinal += 1;
    }
  }
  return {
    manifest: {
      target: 'staging',
      evidence: Object.fromEntries(REQUIRED_CAPACITY_EVIDENCE.map((name) => [name, true])),
      runs,
    },
    controls,
  };
}

describe('capacity GO/NO-GO evaluator', () => {
  it('emits GO only with every required run and evidence item', () => {
    const { manifest, controls } = passingManifest();
    expect(evaluateCapacityGate(manifest, controls)).toMatchObject({
      decision: 'GO',
      reasons: [],
      evaluated_runs: 21,
    });
  });

  it('fails closed when an SLO failed or evidence is missing', () => {
    const { manifest, controls } = passingManifest();
    manifest.evidence.health_after = false;
    controls[0].metrics.thresholds_passed = false;
    const result = evaluateCapacityGate(manifest, controls);
    expect(result.decision).toBe('NO-GO');
    expect(result.reasons).toContain('evidence_missing:health_after');
    expect(result.reasons).toContain('threshold_failed:smoke#1');
  });

  it('rejects overlapping sequence ranges and mixed targets', () => {
    const { manifest, controls } = passingManifest();
    controls[1].metrics.sequence_base = controls[0].metrics.sequence_base - 6_000_000;
    controls[1].metrics.target = 'test-production';
    const result = evaluateCapacityGate(manifest, controls);
    expect(result.decision).toBe('NO-GO');
    expect(result.reasons).toContain('target_mismatch:idempotency#2');
    expect(result.reasons.some((reason) => reason.startsWith('sequence_range_overlap:'))).toBe(true);
  });

  it('re-evaluates the strict SLO values instead of trusting a sidecar flag', () => {
    const metrics = {
      checks: { thresholds: { 'rate==1': { ok: true } } },
      collection_ingress_ack_ms: {
        values: { 'p(95)': 249 }, thresholds: { 'p(95)<250': { ok: true } },
      },
      collection_decision_ms: {
        values: { 'p(95)': 801, 'p(99)': 1_900 },
        thresholds: { 'p(95)<800': { ok: false }, 'p(99)<2000': { ok: true } },
      },
      collection_projection_ms: {
        values: { 'p(95)': 499 }, thresholds: { 'p(95)<500': { ok: true } },
      },
      collection_queue_age_ms: {
        values: { 'p(99)': 1_999 }, thresholds: { 'p(99)<2000': { ok: true } },
      },
    };
    expect(inspectSummaryArtifact({ metrics })).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining([
        'slo_failed:collection_decision_ms:p(95):801/800',
      ]),
    });
  });
});
