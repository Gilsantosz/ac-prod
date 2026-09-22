import { buildOperationalAnalysis, formatMetric, ratio } from '@/lib/operationalAnalysis';
import { getProductionMetricRule, getUnitLabel, normalizeProductionUnit, normalizeRuleText } from '@/lib/productionUnitRules';
import { isValidProductionEntry } from '@/lib/productionMetrics';

const n = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const text = (value) => normalizeRuleText(value).replace(/\s+/g, ' ');
const sector = (row) => String(row.sector_id ?? row.sectorId ?? row.sector ?? '');
const alias = (name) => ({ borda: 'bordo', furadeira: 'furacao', usinagem: 'usinagem cnc' }[text(name)] || text(name));
export const goalStatusLabel = (status) => ({ matched: 'Meta vinculada', inherited: 'Meta vigente', zero: 'Meta zerada', missing: 'Sem meta compatível', invalid: 'Meta inválida', pending_measurement: 'Medição pendente', non_workday: 'Fora do calendário', unavailable: 'Base indisponível' }[status] || status);

// Presentation-only normalization. Never update the ledger or infer meters/sheets
// from a piece counter. The known collection protocols supply pieces_quantity.
export function normalizeDashboardProduction(rows = []) {
  return rows.filter(isValidProductionEntry).map((row) => {
    const rule = getProductionMetricRule(row);
    let unit = rule.unit, produced = n(row.produced);
    let reportedUnit = row._reportedUnit;
    const pieceProtocol = row.entry_mode === 'manual_volume'
      || ['manual_untraceable_stage', 'collection_fabric_v3'].includes(row.source);
    if (pieceProtocol && ['sheets', 'meters'].includes(unit) && n(row.pieces_quantity) > 0) {
      const measured = n(row[unit === 'sheets' ? 'sheet_count' : 'edge_meters']);
      if (measured > 0) produced = measured;
      else { reportedUnit = unit; unit = 'pieces'; produced = n(row.pieces_quantity); }
    }
    return { ...row, cell: String(row.cell || '').trim().replace(/\s+/g, ' '),
      metric_unit: unit, unitLabel: getUnitLabel(unit), produced,
      target: n(row.target), scrap: n(row.scrap), downtime: n(row.downtime),
      _reportedUnit: reportedUnit, _recordedProduced: row._recordedProduced ?? row.produced };
  });
}

function dateRange(period) {
  const from = new Date(`${period?.from}T12:00:00Z`), to = new Date(`${period?.to}T12:00:00Z`);
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || from > to) throw new Error('Período de análise inválido.');
  const size = Math.round((to - from) / 86400000) + 1;
  if (size > 366) throw new Error('Selecione um período de até um ano para analisar as metas.');
  return Array.from({ length: size }, (_, i) => new Date(+from + i * 86400000).toISOString().slice(0, 10));
}

function cellResolver(validCells) {
  const names = (validCells || []).map((c) => typeof c === 'string' ? c : c.name);
  return (value) => {
    const exact = names.find((name) => text(name) === text(value));
    if (exact) return exact;
    const matches = names.filter((name) => alias(name) === alias(value));
    if (matches.length === 1) return matches[0];
    return validCells !== undefined ? null : String(value || '').trim();
  };
}

function isScheduled(date, cell, shift, rows, scope) {
  const overrides = rows.filter((r) => r.date === date && (!sector(r) || sector(r) === scope)
    && (!r.cell || text(r.cell) === text(cell)) && (!r.shift || text(r.shift) === text(shift)))
    .sort((a, b) => ((b.cell ? 2 : 0) + (b.shift ? 1 : 0)) - ((a.cell ? 2 : 0) + (a.shift ? 1 : 0))
      || String(b.updated_at || b.id || '').localeCompare(String(a.updated_at || a.id || '')));
  if (overrides.length) return (overrides[0].is_workday ?? overrides[0].isWorkday) !== false;
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6; // Existing workdays.js default; explicit calendar wins.
}

export function aggregateGoalBuckets(buckets, keyFor) {
  const groups = new Map();
  for (const b of buckets) {
    const key = keyFor(b);
    const g = groups.get(key) || { key, cell: b.cell, metric_unit: b.metric_unit, unitLabel: b.unitLabel,
      produced: 0, target: 0, scrap: 0, downtime: 0, count: 0, missingTargets: 0,
      buckets: 0, matchedGoals: 0, inheritedGoals: 0, noProduction: 0, measurementPending: 0, knownTargets: 0 };
    for (const field of ['produced', 'scrap', 'downtime', 'count']) g[field] += b[field];
    g.target += b.target ?? 0;
    g.buckets++;
    g.knownTargets += b.target != null ? 1 : 0;
    g.matchedGoals += b.target > 0 && !b.measurementPending ? 1 : 0;
    g.inheritedGoals += b.is_inherited ? 1 : 0;
    g.noProduction += b.count === 0 ? 1 : 0;
    g.measurementPending += b.measurementPending;
    // A known plan without readings is visible, not silently dropped. A reading
    // without comparable goals makes the aggregate partial, never 100% by default.
    g.missingTargets += (b.count > 0 && !(b.target > 0)) || b.measurementPending || b.unavailable ? 1 : 0;
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ ...g,
    target: g.knownTargets ? g.target : null,
    attainment: g.count && !g.missingTargets ? ratio(g.produced, g.target) : null,
    gap: g.count && !g.missingTargets && g.target > 0 ? Math.max(0, g.target - g.produced) : null,
    scrapRate: ratio(g.scrap, g.produced + g.scrap),
  }));
}

/** Reconcile once per date/sector/cell/shift/unit, not once per reading/machine.
 * History is effective until replaced, exactly as the Cells and Goals registry.
 * Workday overrides and the existing Mon-Fri default govern planned days.
 */
export function buildDashboardGoalAnalysis(source = [], goals = [], options = {}) {
  const { period, filters = {}, validCells, calendar = [], status = 'ready' } = options;
  const dates = dateRange(period);
  const resolveCell = cellResolver(validCells);
  const inScope = (row) => resolveCell(row.cell || row.cell_name)
    && (!filters.cell || filters.cell === 'all' || text(resolveCell(row.cell || row.cell_name)) === text(resolveCell(filters.cell)))
    && (!filters.shift || filters.shift === 'all' || text(row.shift) === text(filters.shift))
    && (!filters.sector_id || sector(row) === String(filters.sector_id));
  const normalized = normalizeDashboardProduction(source).filter((e) => e.date >= period.from && e.date <= period.to && inScope(e))
    .map((e) => ({ ...e, cell: resolveCell(e.cell) }));
  const selected = normalized.filter((e) => !filters.metric_unit || e.metric_unit === filters.metric_unit);
  const base = buildOperationalAnalysis(selected);
  const contextKey = (r) => JSON.stringify([sector(r), text(r.cell), text(r.shift)]);
  const goalKey = (r) => JSON.stringify([contextKey(r), r.metric_unit]);
  const timelines = new Map();
  for (const goal of goals) {
    if (!inScope(goal) || goal.date > period.to) continue;
    const unit = normalizeProductionUnit(goal.metric_unit, null);
    if (!unit) continue; // An unknown unit must never silently become pieces.
    const row = { ...goal, cell: resolveCell(goal.cell_name || goal.cell), metric_unit: unit };
    const key = goalKey(row);
    if (!timelines.has(key)) timelines.set(key, []);
    timelines.get(key).push(row);
  }
  timelines.forEach((history) => history.sort((a, b) => a.date.localeCompare(b.date)
    || String(a.updated_at || '').localeCompare(String(b.updated_at || '')) || String(a.id || '').localeCompare(String(b.id || ''))));
  const effective = (history, date) => {
    let lo = 0, hi = history.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (history[mid].date <= date) lo = mid + 1; else hi = mid; }
    return lo ? history[lo - 1] : null;
  };
  const buckets = new Map();
  const make = (row, date, goal = null) => {
    const key = JSON.stringify([date, goalKey(row)]);
    if (buckets.has(key)) return buckets.get(key);
    const scheduled = isScheduled(date, row.cell, row.shift, calendar, sector(row));
    const target = status === 'ready' && scheduled && goal && goal.target != null && Number.isFinite(Number(goal.target)) && Number(goal.target) >= 0 ? Number(goal.target) : null;
    const b = { key, date, cell: row.cell, shift: row.shift, sector_id: sector(row), metric_unit: row.metric_unit,
      unitLabel: getUnitLabel(row.metric_unit), produced: 0, target, scrap: 0, downtime: 0, count: 0,
      measurementPending: 0, goal_id: goal?.id, goal_date: goal?.date, is_inherited: Boolean(goal && goal.date < date),
      unavailable: status !== 'ready',
      status: status !== 'ready' ? 'unavailable' : !scheduled ? 'non_workday' : !goal ? 'missing' : target == null ? 'invalid' : target === 0 ? 'zero' : goal.date < date ? 'inherited' : 'matched' };
    buckets.set(key, b);
    return b;
  };
  // Include planned cells/shifts with no entries. No fabricated production rows.
  for (const date of dates) {
    for (const history of timelines.values()) {
      const goal = effective(history, date);
      if (goal && (!filters.metric_unit || goal.metric_unit === filters.metric_unit)
        && isScheduled(date, goal.cell, goal.shift, calendar, sector(goal))) make(goal, date, goal);
    }
  }
  for (const entry of selected) {
    const goal = effective(timelines.get(goalKey(entry)) || [], entry.date);
    const b = make(entry, entry.date, goal);
    for (const field of ['produced', 'scrap', 'downtime']) b[field] += entry[field];
    b.count++;
  }
  // A piece-only reading cannot demonstrate zero meters/sheets or target failure.
  for (const entry of normalized.filter((e) => e._reportedUnit)) {
    const key = JSON.stringify([entry.date, JSON.stringify([contextKey(entry), entry._reportedUnit])]);
    const b = buckets.get(key);
    if (b) { b.measurementPending += entry.produced; b.status = 'pending_measurement'; }
  }
  const rows = [...buckets.values()];
  const units = aggregateGoalBuckets(rows, (b) => b.metric_unit);
  const cells = aggregateGoalBuckets(rows, (b) => JSON.stringify([sector(b), b.cell, b.metric_unit]));
  const insights = [];
  const add = (id, level, title, evidence, action) => insights.push({ id, level, title, evidence, action });
  if (status !== 'ready') add('goal-source-unavailable', 'attention', status === 'loading' ? 'Carregando produção e metas' : 'Não foi possível confirmar a base',
    'A conexão ainda não confirmou produção, metas e calendário deste recorte. Percentuais estão suspensos para evitar uma conclusão incorreta.',
    'Atualize a consulta. Não recadastre metas nem repita baixas por causa deste aviso.');
  const mismatches = normalized.filter((e) => e._reportedUnit && (!filters.metric_unit || [e.metric_unit, e._reportedUnit].includes(filters.metric_unit)));
  if (mismatches.length) {
    const parts = [...new Set(mismatches.map((e) => e.cell))].map((cell) => `${cell}: ${formatMetric(mismatches.filter((e) => e.cell === cell).reduce((s, e) => s + e.produced, 0))} peças`).join('; ');
    add('measurement-unit', 'attention', 'Peças não são metros nem chapas', parts + '. As baixas informam peças, sem a medição física necessária para comparar com essas metas.',
      'Confira metros de borda ou chapas consumidas na origem. O painel preserva a contagem em peças e não faz conversão 1:1.');
  }
  if (status === 'ready') {
    const missing = rows.filter((b) => b.count > 0 && ['missing', 'zero', 'invalid', 'non_workday'].includes(b.status));
    if (missing.length) {
      const b = missing[0];
      const compatible = [...timelines.values()].map((h) => effective(h, b.date)).filter((g) => g && contextKey(g) === contextKey(b));
      add('goal-link-gap', 'attention', `${b.cell}: ${goalStatusLabel(b.status).toLowerCase()}`,
        `${b.shift || 'Turno não informado'} · ${b.date.split('-').reverse().join('/')} · ${formatMetric(b.produced)} ${b.unitLabel}. ${compatible.length ? `Cadastro encontrado em: ${[...new Set(compatible.map((g) => getUnitLabel(g.metric_unit)))].join(', ')}.` : 'Nenhuma meta vigente compatível nesta chave.'}`,
        b.status === 'zero' ? 'A meta zero foi respeitada; capacidade não a substitui. Confirme se esse valor é intencional.' : 'Confira célula, turno, unidade, vigência e calendário em Células e Metas. Não use a meta de outra unidade ou de uma data futura.');
    }
    const inherited = rows.filter((b) => b.target > 0 && b.is_inherited);
    if (inherited.length) add('goals-linked', 'info', 'Metas vigentes recuperadas do cadastro',
      `${inherited.length} grupo(s) dia/célula/turno/unidade utilizam a última meta cadastrada até a data analisada. A meta é contada uma vez por turno, não a cada baixa.`,
      'Abra a conferência abaixo para ver o valor e a data de origem. Uma nova meta substitui a anterior somente a partir da sua data.');
    const comparable = cells.filter((c) => c.attainment != null);
    const below = comparable.filter((c) => c.attainment < 100).sort((a, b) => a.attainment - b.attainment);
    if (below.length) {
      const c = below[0];
      add('target-gap', 'attention', `${c.cell}: saldo para a meta`, `${formatMetric(c.produced)} de ${formatMetric(c.target)} ${c.unitLabel} (${formatMetric(c.attainment)}%). Restam ${formatMetric(c.gap)} ${c.unitLabel}.`,
        'Este é o avanço sobre a meta integral do período, não atraso por hora. Confira o estágio do turno e os motivos das paradas antes de agir.');
    } else if (comparable.length) add('target-met', 'positive', 'Meta alcançada nos grupos comparáveis', `${comparable.length} grupo(s) com produção e metas compatíveis atingiram 100% ou mais.`, 'Confira qualidade e fechamento dos apontamentos; grupos sem base não participam desta conclusão.');
    const empty = rows.filter((b) => b.target > 0 && b.count === 0 && !b.measurementPending);
    if (empty.length) add('no-production-plan', 'info', 'Metas previstas sem apontamento', `${empty.length} grupo(s) do recorte têm meta vigente, mas não possuem produção registrada.`, 'Verifique calendário e horário de início dos turnos. Ausência de apontamento não comprova parada ou falta de produção física.');
  }
  insights.push(...base.insights.filter((i) => ['downtime', 'scrap'].includes(i.id)));
  if (!insights.length) add('empty', 'info', 'Nenhum apontamento neste recorte', 'Não há produção nem metas aplicáveis aos filtros selecionados.', 'Confira período, turno, célula e unidade antes de avaliar desempenho.');
  const methodology = [
    'Metas: production_daily_goals, a mesma fonte de Células e Metas. A última meta até cada data permanece vigente até ser substituída; zero é respeitado e capacidade não substitui meta.',
    'Cada meta é contada uma vez por dia/célula/turno/unidade. Metas nunca são multiplicadas pela quantidade de leituras ou máquinas. O detalhamento de lançamentos preserva a meta histórica da escrita.',
    'Calendário cadastrado sobrepõe o padrão seg–sex. Metas em dias sem apontamento continuam visíveis. Períodos incompletos mostram avanço sobre a meta integral, não ritmo horário.',
    'Peças, metros, chapas e capas não são somados nem convertidos entre si. Baixas por peças sem medição de metros/chapas são sinalizadas; registros originais não são alterados.',
    'Atingimento = volume medido / metas compatíveis. Sem base completa ou com falha de consulta, não é calculado. Não é OEE e não é previsão de demanda.',
    ...base.methodology.filter((t) => t.startsWith('Fonte:') || t.startsWith('Refugo =')),
  ];
  return { ...base, entries: selected, units, cells, goalBuckets: rows, period, status, insights, methodology,
    missingTargets: rows.filter((b) => b.count > 0 && !(b.target > 0)).length,
    goalCoverage: { groups: rows.length, linked: rows.filter((b) => b.target > 0 && !b.measurementPending && !b.unavailable).length,
      inherited: rows.filter((b) => b.is_inherited).length, pendingMeasurements: mismatches.length },
    excludedCount: source.filter((e) => e.date >= period.from && e.date <= period.to && !isValidProductionEntry(e)).length };
}
