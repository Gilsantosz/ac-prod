import { describe, expect, it } from 'vitest';
import {
  CAPACITY_PROFILE_REQUIREMENTS,
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
});
