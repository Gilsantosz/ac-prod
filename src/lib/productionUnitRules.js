export const PRODUCTION_UNITS = {
  SHEETS: 'sheets',
  METERS: 'meters',
  PIECES: 'pieces',
  COVERS: 'covers',
};

export const UNIT_LABELS = {
  [PRODUCTION_UNITS.SHEETS]: 'chapas',
  [PRODUCTION_UNITS.METERS]: 'metros',
  [PRODUCTION_UNITS.PIECES]: 'peças',
  [PRODUCTION_UNITS.COVERS]: 'capas',
};

export const UNIT_METRIC_NAMES = {
  [PRODUCTION_UNITS.SHEETS]: 'Chapas produzidas',
  [PRODUCTION_UNITS.METERS]: 'Metros lineares',
  [PRODUCTION_UNITS.PIECES]: 'Peças produzidas',
  [PRODUCTION_UNITS.COVERS]: 'Capas expedidas',
};

export const CELL_UNIT_RULES = [
  {
    unit: PRODUCTION_UNITS.SHEETS,
    metricName: 'Chapas cortadas',
    aliases: ['corte', 'seccionadora', 'seccionadoras', 'serra seccionadora'],
  },
  {
    unit: PRODUCTION_UNITS.METERS,
    metricName: 'Metros de bordo',
    aliases: ['bordo', 'bordeamento', 'coladeira', 'coladeiras', 'colagem de bordo'],
  },
  {
    unit: PRODUCTION_UNITS.PIECES,
    metricName: 'Peças usinadas',
    aliases: ['usinagem', 'furadeira', 'furadeiras', 'cnc', 'furação', 'furacao'],
  },
  {
    unit: PRODUCTION_UNITS.PIECES,
    metricName: 'Peças de marcenaria',
    aliases: ['marcenaria', 'montagem', 'acabamento'],
  },
  {
    unit: PRODUCTION_UNITS.PIECES,
    metricName: 'Peças embaladas',
    aliases: ['embalagem', 'packing', 'embalar'],
  },
  {
    unit: PRODUCTION_UNITS.PIECES,
    metricName: 'Peças expedidas',
    aliases: ['expedição', 'expedicao', 'shipping', 'expedir'],
    configurableUnit: true,
  },
];

const DIRECT_UNIT_ALIASES = {
  sheets: PRODUCTION_UNITS.SHEETS,
  sheet: PRODUCTION_UNITS.SHEETS,
  chapa: PRODUCTION_UNITS.SHEETS,
  chapas: PRODUCTION_UNITS.SHEETS,
  meters: PRODUCTION_UNITS.METERS,
  meter: PRODUCTION_UNITS.METERS,
  metro: PRODUCTION_UNITS.METERS,
  metros: PRODUCTION_UNITS.METERS,
  linear_meters: PRODUCTION_UNITS.METERS,
  metros_lineares: PRODUCTION_UNITS.METERS,
  pieces: PRODUCTION_UNITS.PIECES,
  piece: PRODUCTION_UNITS.PIECES,
  peca: PRODUCTION_UNITS.PIECES,
  pecas: PRODUCTION_UNITS.PIECES,
  peças: PRODUCTION_UNITS.PIECES,
  covers: PRODUCTION_UNITS.COVERS,
  cover: PRODUCTION_UNITS.COVERS,
  capa: PRODUCTION_UNITS.COVERS,
  capas: PRODUCTION_UNITS.COVERS,
};

const DIRECT_QUANTITY_FIELDS = {
  [PRODUCTION_UNITS.SHEETS]: ['sheet_count', 'sheetCount', 'qtd_chapas', 'chapas', 'sheets'],
  [PRODUCTION_UNITS.METERS]: ['edge_meters', 'edgeMeters', 'metros_bordo', 'linear_meters', 'linearMeters'],
  [PRODUCTION_UNITS.PIECES]: ['pieces_quantity', 'piecesQuantity', 'qtd_pecas', 'quantity', 'produced'],
  [PRODUCTION_UNITS.COVERS]: ['covers_quantity', 'coversQuantity', 'qtd_capas', 'capas', 'quantity', 'produced'],
};

export function normalizeRuleText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function number(value) {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstPositiveNumber(source, fields) {
  for (const field of fields) {
    const value = number(source?.[field]);
    if (value > 0) return value;
  }
  return 0;
}

export function normalizeProductionUnit(value, fallback = PRODUCTION_UNITS.PIECES) {
  const key = normalizeRuleText(value).replace(/[\s-]+/g, '_');
  return DIRECT_UNIT_ALIASES[key] || fallback;
}

export function getUnitLabel(unit) {
  return UNIT_LABELS[normalizeProductionUnit(unit)] || UNIT_LABELS[PRODUCTION_UNITS.PIECES];
}

export function getMetricName(unit, fallback) {
  const normalized = normalizeProductionUnit(unit);
  return fallback || UNIT_METRIC_NAMES[normalized] || UNIT_METRIC_NAMES[PRODUCTION_UNITS.PIECES];
}

export function getProductionUnitForCell(cellName, options = {}) {
  const explicit = options.metricUnit || options.metric_unit || options.unit;
  if (explicit) return normalizeProductionUnit(explicit);

  const text = normalizeRuleText([
    cellName,
    options.stepName,
    options.step_name,
    options.operationName,
    options.operation_name,
    options.process_step,
    options.route_name,
  ].filter(Boolean).join(' '));

  const rule = CELL_UNIT_RULES.find((item) =>
    item.aliases.some((alias) => text.includes(normalizeRuleText(alias)))
  );

  if (!rule) return PRODUCTION_UNITS.PIECES;

  if (rule.configurableUnit && options.expeditionUnit) {
    return normalizeProductionUnit(options.expeditionUnit, rule.unit);
  }

  return rule.unit;
}

export function getProductionMetricRule(input = {}) {
  const unit = getProductionUnitForCell(input.cell || input.cellName || input.cell_name || input.current_cell, input);
  const rule = CELL_UNIT_RULES.find((item) => item.unit === unit && (
    item.aliases.some((alias) => normalizeRuleText([
      input.cell,
      input.cellName,
      input.cell_name,
      input.stepName,
      input.step_name,
      input.operationName,
      input.operation_name,
      input.process_step,
    ].filter(Boolean).join(' ')).includes(normalizeRuleText(alias)))
  ));
  return {
    unit,
    unitLabel: getUnitLabel(unit),
    metricName: input.metric_name || rule?.metricName || getMetricName(unit),
  };
}

function edgeIsApplied(value) {
  const text = normalizeRuleText(value);
  return text && !['0', 'false', 'nao', 'não', 'sem fita', 'semfita', '-', 'n'].includes(text);
}

function dimensionInMeters(value) {
  const raw = number(value);
  if (!raw) return 0;
  return raw > 30 ? raw / 1000 : raw;
}

export function calculateEdgeMeters(item = {}) {
  const direct = firstPositiveNumber(item, DIRECT_QUANTITY_FIELDS[PRODUCTION_UNITS.METERS]);
  if (direct > 0) return direct;

  const width = dimensionInMeters(item.width ?? item.comprimento ?? item.length);
  const height = dimensionInMeters(item.height ?? item.largura);
  const quantity = Math.max(1, number(item.quantity ?? item.produced ?? item.pieces_quantity) || 1);
  let meters = 0;

  if (edgeIsApplied(item.edge_front ?? item.edgeFront)) meters += width;
  if (edgeIsApplied(item.edge_back ?? item.edgeBack)) meters += width;
  if (edgeIsApplied(item.edge_left ?? item.edgeLeft)) meters += height;
  if (edgeIsApplied(item.edge_right ?? item.edgeRight)) meters += height;

  if (meters <= 0 && (item.requires_edge || item.requiresEdge) && (width > 0 || height > 0)) {
    meters = (width + height) * 2;
  }

  return Number((meters * quantity).toFixed(3));
}

function isTraceabilityCollection(entry = {}) {
  const source = normalizeRuleText(entry.source || entry.entry_mode || entry.notes);
  return Boolean(entry.client_event_id || entry.clientEventId || source.includes('coleta produtiva') || source.includes('traceability'));
}

export function normalizeProductionQuantity(entry = {}, unitOverride) {
  const unit = normalizeProductionUnit(unitOverride || entry.metric_unit || entry.metricUnit || getProductionMetricRule(entry).unit);
  const direct = firstPositiveNumber(entry, DIRECT_QUANTITY_FIELDS[unit]);
  if (direct > 0) return direct;

  if (unit === PRODUCTION_UNITS.METERS) {
    const meters = calculateEdgeMeters(entry.item || entry.production_lot_item || entry);
    return meters > 0 ? meters : Math.max(1, number(entry.quantity ?? entry.produced) || 1);
  }

  if (unit === PRODUCTION_UNITS.SHEETS && isTraceabilityCollection(entry)) {
    return 0;
  }

  return Math.max(0, number(entry.realized_quantity ?? entry.quantity ?? entry.produced));
}

export function buildProductionMetric(input = {}) {
  const rule = getProductionMetricRule(input);
  const realized = normalizeProductionQuantity(input, rule.unit);
  const target = number(input.planned_target ?? input.target);
  const capacity = number(input.planned_capacity ?? input.capacity);

  return {
    metric_unit: rule.unit,
    metric_unit_label: rule.unitLabel,
    metric_name: rule.metricName,
    realized_quantity: realized,
    planned_target: target,
    planned_capacity: capacity,
    difference_quantity: realized - (target || capacity || 0),
    efficiency_percent: target > 0 ? Math.round((realized / target) * 1000) / 10 : 0,
  };
}

export const resolveProductionMetric = buildProductionMetric;
