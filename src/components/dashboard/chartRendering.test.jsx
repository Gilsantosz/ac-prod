import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HourlyChart from './HourlyChart';
import ShiftCellPanel from './ShiftCellPanel';
import AnnualProductionSummary from './AnnualProductionSummary';
import ProductionAnalysisCharts from '@/components/reports/ProductionAnalysisCharts';

// Keep the actual Recharts renderer: only browser layout measurements are supplied.
beforeEach(() => {
  vi.spyOn(window, 'matchMedia').mockImplementation(() => ({ matches: false, addListener() {}, removeListener() {} }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400,
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback; }
    observe(target) { this.callback([{ target, contentRect: { width: 800, height: 400 } }]); }
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => vi.unstubAllGlobals());

const grouped = [{ key: '11:48', produced: 13, target: 20, efficiency: 65 }];
const entry = { id: 'entry', date: '2026-09-05', cell: 'Embalagem', metric_unit: 'pieces', produced: 13, target: 20 };
const cell = { key: 'Embalagem', cell: 'Embalagem', metric_unit: 'pieces', produced: 13, target: 20, attainment: 65 };
const report = { metadata: {
  analysis: { units: [{ key: 'pieces', unitLabel: 'peças' }], cells: [cell] },
  monthlyRows: [{ ...cell, label: 'Set/2026' }],
} };

async function expectPaintedBars(container) {
  await waitFor(() => {
    const bars = [...container.querySelectorAll('.recharts-bar-rectangle path')];
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      expect(Number(bar.getAttribute('width'))).toBeGreaterThan(0);
      expect(Number(bar.getAttribute('height'))).toBeGreaterThan(0);
      const id = bar.getAttribute('fill').match(/^url\(#(.+)\)$/)?.[1];
      expect(id).toBeTruthy();
      const gradient = document.getElementById(id);
      expect(gradient, `Missing SVG paint server: ${id}`).not.toBeNull();
      expect(bar.closest('svg').contains(gradient)).toBe(true);
      expect(gradient.querySelectorAll('stop')).toHaveLength(2);
    }
  });
}

describe('production charts render visible gradient bars', () => {
  it.each([
    ['hourly', () => <HourlyChart grouped={grouped} unitLabel="peças" />],
    ['cell/shift', () => <ShiftCellPanel grouped={grouped} title="Por célula" />],
    ['annual', () => <AnnualProductionSummary entries={[entry]} year={2026} />],
    ['reports', () => <ProductionAnalysisCharts report={report} />],
  ])('%s includes the paint servers referenced by its actual bars', async (_name, chart) => {
    const { container } = render(chart());
    await expectPaintedBars(container);
  });

  it('updates painted geometry when selected data changes, and removes bars for an empty selection', async () => {
    const { container, rerender } = render(<HourlyChart grouped={grouped} />);
    await expectPaintedBars(container);
    const produced = () => container.querySelector('path.recharts-rectangle[fill$="-produced)"]');
    const originalHeight = Number(produced().getAttribute('height'));
    rerender(<HourlyChart grouped={[{ ...grouped[0], produced: 7 }]} />);
    await expectPaintedBars(container);
    expect(Number(produced().getAttribute('height'))).toBeLessThan(originalHeight);
    rerender(<HourlyChart grouped={[]} />);
    expect(container.querySelectorAll('.recharts-bar-rectangle path')).toHaveLength(0);
  });

  it('draws the reported 13 pieces even without a target', async () => {
    const { container } = render(<HourlyChart grouped={[{ key: '11:48', produced: 13, target: 0, efficiency: null }]} />);
    await expectPaintedBars(container);
    expect(container.querySelector('path.recharts-rectangle[fill$="-produced)"]')).not.toBeNull();
  });
});
