// Consolida métricas de produção do dia para a tela de Resumo Diário.
import {
  buildProductionMetric,
  getProductionMetricRule,
  getUnitLabel,
  normalizeProductionQuantity as normalizeQuantityByUnit,
  normalizeProductionUnit as normalizeUnit,
} from '@/lib/productionUnitRules';

function acc(list) {
  const produced = list.reduce((a, e) => a + (Number(e.produced ?? e.realized_quantity) || 0), 0);
  const scrap = list.reduce((a, e) => a + (Number(e.scrap) || 0), 0);
  const downtime = list.reduce((a, e) => a + (Number(e.downtime) || 0), 0);
  const target = list.reduce((a, e) => a + (Number(e.target ?? e.planned_target) || 0), 0);
  const good = Math.max(produced - scrap, 0);
  const scrapRate = produced > 0 ? Math.round((scrap / produced) * 1000) / 10 : 0;
  return { produced, scrap, good, downtime, target, scrapRate };
}

const SHIFTS = ['1º Turno', '2º Turno', '3º Turno'];

const number = (value) => Number(value) || 0;
const round1 = (value) => Math.round((Number(value) || 0) * 10) / 10;
const key = (...parts) => parts.map((part) => String(part ?? '—')).join('||');

function emptyBucket({ shift = '', cell = '', area = '', unit = 'pieces', metricName = '' } = {}) {
  return {
    shift,
    cell,
    area: area || cell,
    metric_unit: normalizeUnit(unit),
    unitLabel: getUnitLabel(unit),
    metricName: metricName || getProductionMetricRule({ cell, metric_unit: unit }).metricName,
    capacity: 0,
    target: 0,
    realized: 0,
    produced: 0,
    scrap: 0,
    good: 0,
    downtime: 0,
    entries: 0,
    hasGoal: false,
  };
}

function finalizeBucket(bucket) {
  const capacity = round1(bucket.capacity);
  const target = round1(bucket.target);
  const realized = round1(bucket.realized);
  const scrap = round1(bucket.scrap);
  return {
    ...bucket,
    capacity,
    target,
    realized,
    produced: realized,
    scrap,
    good: Math.max(realized - scrap, 0),
    differenceCapacity: round1(realized - capacity),
    differenceTarget: round1(realized - target),
    efficiencyCapacity: capacity > 0 ? round1((realized / capacity) * 100) : 0,
    efficiencyTarget: target > 0 ? round1((realized / target) * 100) : 0,
    scrapRate: realized > 0 ? round1((scrap / realized) * 100) : 0,
  };
}

export function normalizeProductionUnit(entry) {
  return getProductionMetricRule(entry).unit;
}

export function normalizeProductionQuantity(entry) {
  return normalizeQuantityByUnit(entry, normalizeProductionUnit(entry));
}

function applyEntry(bucket, entry, metric) {
  const realized = number(metric.realized_quantity);
  bucket.realized += realized;
  bucket.scrap += number(entry.scrap);
  bucket.downtime += number(entry.downtime);
  bucket.entries += 1;
  if (!bucket.hasGoal) {
    bucket.capacity += number(entry.planned_capacity ?? entry.capacity);
    bucket.target += number(entry.planned_target ?? entry.target);
  }
}

function goalToBucket(goal) {
  const unit = normalizeUnit(goal.metric_unit || goal.metricUnit || goal.unit);
  const cell = goal.cell_name || goal.cell || 'Sem célula';
  const bucket = emptyBucket({
    shift: goal.shift || '—',
    cell,
    area: goal.area_name || goal.area || cell,
    unit,
    metricName: goal.metric_name,
  });
  bucket.capacity = number(goal.capacity);
  bucket.target = number(goal.target);
  bucket.hasGoal = true;
  return bucket;
}

function entryContext(entry) {
  const metric = buildProductionMetric(entry);
  const cell = entry.cell || entry.cellName || entry.cell_name || 'Sem célula';
  const area = entry.area_name || entry.area || cell;
  const shift = entry.shift || '—';
  return { metric, cell, area, shift };
}

export function buildDailySummaryByCellShift(entries = [], goals = []) {
  const map = new Map();

  goals.forEach((goal) => {
    const bucket = goalToBucket(goal);
    map.set(key(bucket.cell, bucket.metric_unit, bucket.shift), bucket);
  });

  entries.forEach((entry) => {
    const { metric, cell, area, shift } = entryContext(entry);
    const bucketKey = key(cell, metric.metric_unit, shift);
    const bucket = map.get(bucketKey) || emptyBucket({
      shift,
      cell,
      area,
      unit: metric.metric_unit,
      metricName: metric.metric_name,
    });
    applyEntry(bucket, entry, metric);
    map.set(bucketKey, bucket);
  });

  return [...map.values()].map(finalizeBucket);
}

export function buildDailySummaryByUnit(entries = [], goals = []) {
  const byUnit = new Map();
  const cells = buildDailySummaryByCellShift(entries, goals);

  cells.forEach((row) => {
    const unit = row.metric_unit;
    const bucket = byUnit.get(unit) || emptyBucket({ unit, cell: getUnitLabel(unit), metricName: row.metricName });
    bucket.capacity += row.capacity;
    bucket.target += row.target;
    bucket.realized += row.realized;
    bucket.scrap += row.scrap;
    bucket.downtime += row.downtime;
    bucket.entries += row.entries;
    byUnit.set(unit, bucket);
  });

  return [...byUnit.values()]
    .map(finalizeBucket)
    .sort((a, b) => a.unitLabel.localeCompare(b.unitLabel));
}

export function buildDailySummaryMatrix(entries = [], goals = []) {
  const grouped = new Map();
  const shiftRows = buildDailySummaryByCellShift(entries, goals);
  const shifts = [...new Set([...SHIFTS, ...shiftRows.map((row) => row.shift).filter(Boolean)])];

  shiftRows.forEach((row) => {
    const rowKey = key(row.cell, row.metric_unit);
    const current = grouped.get(rowKey) || {
      cell: row.cell,
      area: row.area,
      metric_unit: row.metric_unit,
      unitLabel: row.unitLabel,
      metricName: row.metricName,
      shifts: Object.fromEntries(shifts.map((shift) => [shift, finalizeBucket(emptyBucket({ shift, cell: row.cell, area: row.area, unit: row.metric_unit, metricName: row.metricName }))])),
      total: emptyBucket({ cell: row.cell, area: row.area, unit: row.metric_unit, metricName: row.metricName }),
    };
    current.shifts[row.shift] = row;
    current.total.capacity += row.capacity;
    current.total.target += row.target;
    current.total.realized += row.realized;
    current.total.scrap += row.scrap;
    current.total.downtime += row.downtime;
    current.total.entries += row.entries;
    grouped.set(rowKey, current);
  });

  return [...grouped.values()]
    .map((row) => ({ ...row, total: finalizeBucket(row.total), shiftLabels: shifts }))
    .sort((a, b) => a.cell.localeCompare(b.cell) || a.unitLabel.localeCompare(b.unitLabel));
}

function buildCompatRows(matrix, field) {
  if (field === 'cell') {
    return matrix.map((row) => ({
      id: key(row.cell, row.metric_unit),
      cell: row.cell,
      metric_unit: row.metric_unit,
      unitLabel: row.unitLabel,
      ...row.total,
    }));
  }

  const byShiftUnit = new Map();
  matrix.forEach((row) => {
    Object.entries(row.shifts).forEach(([shift, bucket]) => {
      const bucketKey = key(shift, row.metric_unit);
      const current = byShiftUnit.get(bucketKey) || emptyBucket({
        shift,
        cell: shift,
        unit: row.metric_unit,
        metricName: row.metricName,
      });
      current.capacity += bucket.capacity;
      current.target += bucket.target;
      current.realized += bucket.realized;
      current.scrap += bucket.scrap;
      current.downtime += bucket.downtime;
      current.entries += bucket.entries;
      byShiftUnit.set(bucketKey, current);
    });
  });

  return [...byShiftUnit.values()]
    .filter((row) => row.entries > 0 || row.target > 0 || row.capacity > 0)
    .map((row) => ({ id: key(row.shift, row.metric_unit), shift: row.shift, ...finalizeBucket(row) }))
    .sort((a, b) => a.shift.localeCompare(b.shift) || a.unitLabel.localeCompare(b.unitLabel));
}

// Resumo total + granular por célula e por turno.
export function buildDailySummary(entries = [], goals = []) {
  const total = acc(entries);
  const matrixByCell = buildDailySummaryMatrix(entries, goals);
  const totalsByUnit = buildDailySummaryByUnit(entries, goals);

  const byCell = buildCompatRows(matrixByCell, 'cell');
  const byShift = buildCompatRows(matrixByCell, 'shift');

  return {
    total,
    byCell,
    byShift,
    byCellShift: buildDailySummaryByCellShift(entries, goals),
    totalsByUnit,
    matrixByCell,
    shifts: [...new Set([...SHIFTS, ...byShift.map((row) => row.shift)])],
  };
}
