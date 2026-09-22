import { describe, expect, it } from 'vitest';
import { buildDashboardGoalAnalysis as analyze, normalizeDashboardProduction } from './dashboardGoalAnalysis';
import { createProductionAnalysisReport } from './reports/productionAnalysisReport';

const day = '2026-09-21';
const opts = { period: { from: day, to: day }, validCells: ['Corte', 'Bordo', 'Embalagem', 'Furação'] };
const goal = (patch = {}) => ({ id: 'goal', date: '2026-07-29', cell_name: 'Bordo', shift: '1º Turno', metric_unit: 'meters', target: 3000, capacity: 9999, ...patch });
const entry = (patch = {}) => ({ id: 'entry', date: day, cell: 'Bordo', shift: '1º Turno', metric_unit: 'meters', produced: 875, target: 0, scrap: 0, downtime: 0, ...patch });
const meters = (analysis) => analysis.units.find((u) => u.key === 'meters');

 describe('reconciliação das metas vigentes do painel', () => {
  it('recupera a meta antiga vigente embora a escrita possua target zero', () => {
    const a = analyze([entry()], [goal()], opts);
    expect(meters(a).target).toBe(3000);
    expect(meters(a).attainment).toBeCloseTo(29.1666667);
    expect(a.goalBuckets[0]).toMatchObject({ goal_date: '2026-07-29', is_inherited: true });
    expect(a.insights.some((i) => i.id === 'missing-target')).toBe(false);
  });
  it('conta a meta do turno uma única vez para muitas leituras e máquinas', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => entry({ id: `${i}`, machine_id: `${i % 20}`, produced: 1, target: 3000 }));
    const a = analyze(rows, [goal()], opts);
    expect(meters(a)).toMatchObject({ produced: 1000, target: 3000 });
    expect(a.goalBuckets).toHaveLength(1);
  });
  it('substitui pela meta da data e ignora metas futuras', () => {
    const a = analyze([entry()], [goal(), goal({ id: 'today', date: day, target: 1000 }), goal({ id: 'future', date: '2026-09-22', target: 99999 })], opts);
    expect(meters(a).target).toBe(1000);
    expect(a.goalBuckets[0].is_inherited).toBe(false);
  });
  it('reconstrói cada vigência no período, sem aplicar a meta mais nova retroativamente', () => {
    const a = analyze([entry({ date: '2026-09-18' }), entry()], [goal({ target: 1000 }), goal({ id: 'new', date: day, target: 2000 })], { ...opts, period: { from: '2026-09-18', to: day } });
    expect(meters(a).target).toBe(3000); // Fri + Mon; no fabricated weekend plan.
    expect(a.goalBuckets.map((b) => b.target)).toEqual([1000, 2000]);
  });
  it('respeita zero explícito e não substitui por capacidade ou meta anterior', () => {
    const a = analyze([entry()], [goal(), goal({ id: 'zero', date: day, target: 0 })], opts);
    expect(meters(a).target).toBe(0);
    expect(meters(a).attainment).toBeNull();
    expect(a.goalBuckets[0].status).toBe('zero');
  });
  it.each([null, -10, 'texto'])('sinaliza meta inválida: %s', (target) => {
    const a = analyze([entry()], [goal({ target })], opts);
    expect(meters(a).target).toBeNull(); expect(meters(a).attainment).toBeNull();
  });
  it('normaliza acentos, espaços, caixa e unidades sem cruzar células numeradas', () => {
    const a = analyze([entry({ cell: 'Furação ', metric_unit: 'pieces' })], [goal({ cell_name: 'FURACAO', metric_unit: 'Peças' }), goal({ id: 'another', cell_name: 'Furação 2', metric_unit: 'pieces', target: 99999 })], opts);
    expect(a.units[0].target).toBe(3000);
  });
  it('mantém unidades, células, turnos e setores independentes', () => {
    const a = analyze([entry({ sector_id: 'LSM' })], [goal({ sector_id: 'LSM' }), goal({ id: 'cs', sector_id: 'CS', target: 6000 }), goal({ id: 'shift2', shift: '2º Turno', target: 1000, sector_id: 'LSM' })], { ...opts, filters: { shift: '1º Turno', sector_id: 'LSM' } });
    expect(meters(a).target).toBe(3000);
  });
  it('não expõe metas de células fora do escopo nem quando a lista autorizada está vazia', () => {
    expect(analyze([entry()], [goal()], { ...opts, validCells: ['Corte'] }).units).toEqual([]);
    expect(analyze([entry()], [goal()], { ...opts, validCells: [] }).units).toEqual([]);
  });
  it('soma metas de turnos diferentes uma vez e aplica o filtro do turno', () => {
    const goals = [goal(), goal({ id: 'shift2', shift: '2º Turno', target: 2000 })];
    expect(meters(analyze([entry()], goals, opts)).target).toBe(5000);
    expect(meters(analyze([entry()], goals, { ...opts, filters: { shift: '1º Turno' } })).target).toBe(3000);
  });
  it('mantém meta de célula sem produção visível sem dizer que houve parada', () => {
    const a = analyze([], [goal()], opts);
    expect(meters(a)).toMatchObject({ target: 3000, count: 0, attainment: null });
    expect(a.insights.some((i) => i.id === 'no-production-plan')).toBe(true);
  });
  it('não calcula atingimento agregado quando uma produção está sem meta compatível', () => {
    const a = analyze([entry(), entry({ cell: 'Embalagem', metric_unit: 'meters' })], [goal()], opts);
    expect(meters(a).attainment).toBeNull();
  });
  it('exclui estornos e não altera os objetos recebidos', () => {
    const source = [entry(), entry({ id: 'reversed', produced: 500, approval_status: 'reversed' })];
    const original = JSON.stringify(source);
    const a = analyze(source, [goal()], opts);
    expect(meters(a).produced).toBe(875); expect(a.excludedCount).toBe(1);
    expect(JSON.stringify(source)).toBe(original);
  });
  it.each(['loading', 'error'])('falha de consulta não vira ausência de meta: %s', (status) => {
    const a = analyze([entry()], [goal()], { ...opts, status });
    expect(meters(a).attainment).toBeNull(); expect(meters(a).target).toBeNull();
    expect(a.insights[0].id).toBe('goal-source-unavailable');
    expect(a.insights.some((i) => i.id === 'target-gap')).toBe(false);
  });
  it('respeita folga e sábado produtivo cadastrados', () => {
    const a = analyze([], [goal()], { ...opts, period: { from: '2026-09-18', to: day }, calendar: [{ date: '2026-09-18', is_workday: false }, { date: '2026-09-19', is_workday: true }] });
    expect(a.goalBuckets.map((b) => b.date)).toEqual(['2026-09-19', day]);
  });
  it('calendário de célula/turno prevalece sobre o global', () => {
    const a = analyze([entry()], [goal()], { ...opts, calendar: [{ date: day, is_workday: false }, { date: day, cell: 'Bordo', shift: '1º Turno', is_workday: true }] });
    expect(meters(a).target).toBe(3000);
  });
  it('preserva produção fora do calendário e pede conferência, sem inventar meta', () => {
    const a = analyze([entry()], [goal()], { ...opts, calendar: [{ date: day, is_workday: false }] });
    expect(meters(a).produced).toBe(875); expect(a.goalBuckets[0].status).toBe('non_workday');
  });
  it('aceita ano bissexto sem multiplicar meta por apontamento', () => {
    const a = analyze([], [goal({ date: '2024-01-01' })], { ...opts, period: { from: '2024-01-01', to: '2024-12-31' } });
    expect(a.goalBuckets).toHaveLength(262); expect(meters(a).target).toBe(786000);
  });
  it('não permite período invertido ou maior que um ano', () => {
    expect(() => analyze([], [], { period: { from: day, to: '2026-01-01' } })).toThrow();
    expect(() => analyze([], [], { period: { from: '2024-01-01', to: '2026-01-01' } })).toThrow();
  });
  it('mostra meta atingida somente para grupos com base comparável', () => {
    const a = analyze([entry({ produced: 3300 })], [goal()], opts);
    expect(meters(a).attainment).toBeCloseTo(110); expect(meters(a).gap).toBe(0);
    expect(a.insights.some((i) => i.id === 'target-met')).toBe(true);
  });
});

 describe('a contagem de peças não pode se transformar em metas físicas', () => {
  it.each([['Bordo', 'meters', 875], ['Corte', 'sheets', 995]])('corrige apenas a apresentação de %s sem alterar a produção', (cell, unit, quantity) => {
    const row = entry({ cell, metric_unit: unit, produced: quantity, pieces_quantity: quantity, edge_meters: 0, sheet_count: 0, entry_mode: 'manual_volume' });
    const a = analyze([row], [goal({ cell_name: cell, metric_unit: unit, target: 150 })], opts);
    expect(a.entries[0]).toMatchObject({ produced: quantity, metric_unit: 'pieces', _reportedUnit: unit });
    expect(a.units.find((u) => u.key === unit).attainment).toBeNull();
    expect(a.insights.some((i) => i.id === 'measurement-unit')).toBe(true);
    expect(row.metric_unit).toBe(unit);
  });
  it('usa medição física explícita quando fornecida pelo protocolo', () => {
    const rows = normalizeDashboardProduction([entry({ source: 'collection_fabric_v3', pieces_quantity: 10, produced: 10, edge_meters: 24.7 })]);
    expect(rows[0]).toMatchObject({ metric_unit: 'meters', produced: 24.7 });
  });
  it('não converte um apontamento manual em metros que já é válido', () => {
    expect(normalizeDashboardProduction([entry()])[0]).toMatchObject({ produced: 875, metric_unit: 'meters' });
  });
  it('normalização é idempotente e conserva a origem da divergência', () => {
    const rows = normalizeDashboardProduction([entry({ entry_mode: 'manual_volume', pieces_quantity: 875 })]);
    expect(normalizeDashboardProduction(rows)).toEqual(rows);
  });
  it('preserva aviso de medição ao filtrar especificamente metros', () => {
    const a = analyze([entry({ entry_mode: 'manual_volume', pieces_quantity: 875 })], [goal()], { ...opts, filters: { metric_unit: 'meters' } });
    expect(a.entries).toEqual([]); expect(meters(a).measurementPending).toBe(875);
    expect(a.insights[0].id).toBe('measurement-unit');
  });
});

 describe('mesma análise no painel e nos relatórios', () => {
  it('PDF/Excel usam o mesmo resumo e mantêm lançamentos sem meta duplicada', () => {
    const rows = [entry(), entry({ id: '2', produced: 125 })];
    const goals = [goal()];
    const expected = analyze(rows, goals, opts);
    const report = createProductionAnalysisReport({ entries: rows, period: opts.period, goalContext: { goals, validCells: opts.validCells } });
    expect(report.metadata.analysis.units).toEqual(expected.units);
    expect(report.metadata.insights).toEqual(expected.insights);
    expect(report.tables.find((t) => t.id === 'production-data').rows.map((r) => r.target)).toEqual([0, 0]);
    expect(report.tables.find((t) => t.id === 'goal-reconciliation').rows).toHaveLength(1);
    expect(report.metadata.monthlyRows[0].target).toBe(3000);
  });
  it('preserva a API sem contexto de metas das outras páginas', () => {
    const report = createProductionAnalysisReport({ entries: [entry({ target: 1000 })], period: opts.period });
    expect(report.metadata.analysis.units[0].target).toBe(1000);
    expect(report.metadata.analysis.goalBuckets).toBeUndefined();
  });
});
