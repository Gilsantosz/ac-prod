import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoFile = (path) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('AC.Prod2 collection rollout contract', () => {
  it('keeps the canonical v2 collection and shift KPI contracts wired', () => {
    const service = repoFile('src/lib/collectionService.js');
    expect(service).toContain('get_collection_dashboard_snapshot_v2');
    expect(service).toContain('get_operator_shift_kpis_v2');
  });
  it('prevents history actions from submitting the scanner form', () => {
    const source = repoFile('src/components/collection/CollectionReadItem.jsx');
    const start = source.indexOf('{/* Ações rápidas no card */}');
    const block = source.slice(start);
    expect(start).toBeGreaterThan(-1);
    expect((block.match(/<Button/g) || []).length).toBeGreaterThanOrEqual(3);
    expect((block.match(/type="button"/g) || []).length).toBeGreaterThanOrEqual(3);
  });
  it('keeps scanner focus suspended while an operational modal is open', () => {
    const scanner = repoFile('src/components/traceability/TraceabilityScannerPanel.jsx');
    const page = repoFile('src/pages/TraceabilityCollection.jsx');
    expect(scanner).toContain('modalOpen = false');
    expect(scanner).toContain('isSuspended');
    expect(scanner).toContain('hasOpenDialog');
    expect(page).toContain('modalOpen={isAnyModalOpen}');
  });
  it('subscribes lifecycle and active-context tables to global invalidation', () => {
    const realtime = repoFile('src/hooks/useProductionRealtimeSync.js');
    expect(realtime).toContain('production_cell_lot_states');
    expect(realtime).toContain('production_cell_active_contexts');
  });
  it('mounts exactly one global realtime synchronizer above every authenticated route', () => {
    const app = repoFile('src/App.jsx');
    const layout = repoFile('src/components/layout/AppLayout.jsx');
    const dailySummary = repoFile('src/pages/DailySummary.jsx');
    const routeTree = [app, layout, dailySummary].join('\n');
    const synchronizerCalls = routeTree.match(/\buse(?:ProductionRealtime|Realtime)Sync\s*\(/g) || [];

    expect(synchronizerCalls).toEqual(['useProductionRealtimeSync(']);
    expect(app).toContain('useProductionRealtimeSync({ enabled: !!user && !isLoadingAuth && !authError });');
    expect(app).toContain('<Route element={<AppLayout />}>');
    expect(app).toContain('<Route path="/resumo-diario" element={<DailySummary />} />');
    expect(layout).not.toMatch(/use(?:ProductionRealtime|Realtime)Sync/);
    expect(dailySummary).not.toContain('useProductionRealtimeSync');
  });
  it('archives superseded migrations and tracks the v7 release marker', () => {
    expect(existsSync(resolve(process.cwd(), 'supabase/migrations/20260831100000_concurrency_batch_lifecycle_operator_shifts.sql'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'supabase/migrations/20260831120000_fix_collection_lifecycle_realtime_shifts_v2.sql'))).toBe(false);
    expect(existsSync(resolve(process.cwd(), 'supabase/migrations/20260831052809_publish_collection_release_probe_v7.sql'))).toBe(true);
  });
});
