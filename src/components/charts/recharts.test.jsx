import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Raw from 'recharts';
import { Bar, Line, ResponsiveContainer, decorateChart, describeChart } from './recharts';

beforeEach(() => {
  vi.spyOn(window, 'matchMedia').mockImplementation(() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400 });
  vi.stubGlobal('ResizeObserver', class { constructor(callback) { this.callback = callback; } observe(target) { this.callback([{ target, contentRect: { width: 800, height: 400 } }]); } unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());
const rows = Array.from({ length: 45 }, (_, index) => ({ label: `Hora ${index + 1}`, produced: index + 1, percent: index === 0 ? null : 105 }));
function chart(data = rows, onClick) {
  return <Raw.ComposedChart data={data} onClick={onClick}>
    <Raw.CartesianGrid vertical={false} /><Raw.XAxis dataKey="label" />
    <Raw.YAxis yAxisId="volume" /><Raw.YAxis yAxisId="percent" orientation="right" unit="%" domain={[0, 'auto']} />
    <Raw.Tooltip /><Raw.Bar dataKey="produced" name="Produzido" yAxisId="volume" fill="#15803d" />
    <Raw.Line dataKey="percent" name="Atingimento" yAxisId="percent" stroke="#0284c7" connectNulls={false} />
  </Raw.ComposedChart>;
}
async function expectPainted(container) {
  await waitFor(() => {
    const bars = container.querySelectorAll('.recharts-bar-rectangle path');
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      expect(Number(bar.getAttribute('width'))).toBeGreaterThan(0);
      expect(Number(bar.getAttribute('height'))).toBeGreaterThan(0);
      const id = bar.getAttribute('fill').match(/^url\(#(.+)\)$/)?.[1];
      expect(id).toBeTruthy();
      expect(bar.closest('svg').querySelector(`[id="${id}"]`)).not.toBeNull();
    }
  });
}
describe('shared chart presentation', () => {
  it('re-exports original Recharts 2 primitives, not wrappers', () => {
    expect(Bar).toBe(Raw.Bar); expect(Line).toBe(Raw.Line);
  });
  it('preserves data, axes, percent >100, null gaps and source click handler', () => {
    const click = vi.fn(), pin = vi.fn();
    const styled = decorateChart(chart(rows, click), 'test', pin);
    expect(styled.props.data).toBe(rows);
    const model = describeChart(styled);
    expect(model.series[1].props.connectNulls).toBe(false);
    expect(model.units[1]).toBe('%');
    expect(rows[0].percent).toBeNull(); expect(rows[1].percent).toBe(105);
    styled.props.onClick({ activeLabel: 'Hora 1' }, {});
    expect(click).toHaveBeenCalledTimes(1); expect(pin).toHaveBeenCalledTimes(1);
    const percentAxis = model.children.find(node => node.props?.yAxisId === 'percent' && node.type === Raw.YAxis);
    expect(percentAxis.props.domain).toEqual([0, 'auto']);
  });
  it('renders actual bars, hides/restores, and expands with a single SVG tree', async () => {
    const { container } = render(<ResponsiveContainer width="100%" height={300} chartTitle="Ensaio">{chart()}</ResponsiveContainer>);
    await expectPainted(container);
    const originalCount = document.querySelectorAll('.recharts-bar-rectangle path').length;
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar gráfico' }));
    expect(container.querySelectorAll('.recharts-bar-rectangle path')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar gráfico oculto' }));
    await expectPainted(container);
    fireEvent.click(screen.getByRole('button', { name: 'Expandir gráfico' }));
    const dialog = await screen.findByRole('dialog');
    await expectPainted(dialog);
    expect(document.querySelectorAll('.recharts-bar-rectangle path')).toHaveLength(originalCount);
    const lineGradient = dialog.querySelector('linearGradient[gradientUnits="userSpaceOnUse"]');
    expect(lineGradient).not.toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fechar gráfico expandido' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('paginates only the table, preserves the full chart recorte and resets on filters', async () => {
    const { container, rerender } = render(<ResponsiveContainer width="100%" height={300}>{chart()}</ResponsiveContainer>);
    await expectPainted(container);
    fireEvent.click(screen.getByRole('button', { name: 'Próxima página dos dados' }));
    const table = screen.getByRole('table');
    expect(within(table).getByText('Hora 21')).toBeTruthy();
    expect(within(table).queryByText('Hora 1')).toBeNull();
    expect(rows).toHaveLength(45);
    rerender(<ResponsiveContainer width="100%" height={300}>{chart([{ label: 'Filtro novo', produced: 13, percent: null }])}</ResponsiveContainer>);
    await waitFor(() => expect(screen.getByRole('table').textContent).toContain('Filtro novo'));
    expect(screen.getByRole('table').textContent).toContain('—');
  });
});
