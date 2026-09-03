export const CONTROLLABLE_CAPACITY_STATUSES = Object.freeze([
  'requested',
  'running',
  'paused',
  'cancel_requested',
]);

export const CAPACITY_PROFILE_REQUIREMENTS = Object.freeze({
  smoke: Object.freeze({ devices: 1, pieces: 1, duration_minutes: 1 }),
  idempotency: Object.freeze({ devices: 20, pieces: 20, duration_minutes: 1 }),
  microbatch: Object.freeze({ devices: 5, pieces: 125, duration_minutes: 1 }),
  priority: Object.freeze({ devices: 100, pieces: 1_625, duration_minutes: 1 }),
  contention_piece: Object.freeze({ devices: 20, pieces: 1, duration_minutes: 1 }),
  contention_cell_lot: Object.freeze({ devices: 50, pieces: 50, duration_minutes: 1 }),
  atomic8: Object.freeze({ devices: 8, pieces: 1, duration_minutes: 1 }),
  nominal: Object.freeze({ devices: 100, pieces: 18_000, duration_minutes: 10 }),
  burst: Object.freeze({ devices: 100, pieces: 6_000, duration_minutes: 1 }),
});

export const TERMINAL_CAPACITY_STATUSES = Object.freeze([
  'cancelled',
  'emergency_stopped',
  'completed',
  'failed',
]);

const controllableStatuses = new Set(CONTROLLABLE_CAPACITY_STATUSES);

export function isControllableCapacityRun(run) {
  return Boolean(run?.run_id && controllableStatuses.has(run.status));
}

export function selectControllableCapacityRun(runs = [], selectedRunId = null) {
  const selected = runs.find((run) => run.run_id === selectedRunId);
  if (isControllableCapacityRun(selected)) return selected;
  return runs.find(isControllableCapacityRun) || null;
}
