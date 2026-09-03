import { describe, expect, it } from 'vitest';
import {
  CAPACITY_EXECUTOR_STALE_MS,
  CAPACITY_PROFILE_REQUIREMENTS,
  isCapacityExecutorHeartbeatStale,
  isControllableCapacityRun,
  selectControllableCapacityRun,
} from '@/lib/capacityTestControl';

describe('capacity test control selection', () => {
  it('keeps audited workload limits tied to each versioned k6 profile', () => {
    expect(CAPACITY_PROFILE_REQUIREMENTS.smoke).toEqual({
      devices: 1, pieces: 1, duration_minutes: 1,
    });
    expect(CAPACITY_PROFILE_REQUIREMENTS.nominal).toEqual({
      devices: 100, pieces: 18_000, duration_minutes: 10,
    });
  });

  it('restores the newest controllable run after a page reload', () => {
    const runs = [
      { run_id: 'new-completed', status: 'completed' },
      { run_id: 'active-paused', status: 'paused' },
      { run_id: 'older-running', status: 'running' },
    ];

    expect(selectControllableCapacityRun(runs)?.run_id).toBe('active-paused');
  });

  it('keeps the selected run while it remains controllable and clears terminal runs', () => {
    const runs = [
      { run_id: 'new-running', status: 'running' },
      { run_id: 'selected-paused', status: 'paused' },
    ];

    expect(selectControllableCapacityRun(runs, 'selected-paused')?.run_id)
      .toBe('selected-paused');
    expect(isControllableCapacityRun({ run_id: 'done', status: 'emergency_stopped' }))
      .toBe(false);
    expect(selectControllableCapacityRun([{ run_id: 'done', status: 'completed' }]))
      .toBeNull();
  });

  it('marks only an executor-owned run with an expired heartbeat as stale', () => {
    const now = Date.parse('2026-09-03T14:00:30.000Z');
    const staleRun = {
      run_id: 'stale',
      status: 'running',
      executor_id: 'capacity:executor-1',
      executor_heartbeat_at: new Date(now - CAPACITY_EXECUTOR_STALE_MS).toISOString(),
    };

    expect(isCapacityExecutorHeartbeatStale(staleRun, now)).toBe(true);
    expect(isCapacityExecutorHeartbeatStale({
      ...staleRun,
      executor_heartbeat_at: new Date(now - CAPACITY_EXECUTOR_STALE_MS + 1).toISOString(),
    }, now)).toBe(false);
    expect(isCapacityExecutorHeartbeatStale({ ...staleRun, status: 'requested' }, now))
      .toBe(false);
    expect(isCapacityExecutorHeartbeatStale({ ...staleRun, executor_id: null }, now))
      .toBe(false);
  });
});
