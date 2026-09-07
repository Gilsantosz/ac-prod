import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GlassChartPanel from './GlassChartPanel';

beforeEach(() => {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return true; },
  }));
  Element.prototype.scrollIntoView = vi.fn();
});

describe('GlassChartPanel', () => {
  it('collapses and restores chart content with accessible controls', () => {
    render(<GlassChartPanel title="Produção por hora"><div>Conteúdo do gráfico</div></GlassChartPanel>);

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar gráfico' }));
    expect(screen.queryByText('Conteúdo do gráfico')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar gráfico' }));
    expect(screen.getByText('Conteúdo do gráfico')).toBeInTheDocument();
  });

  it('opens an expanded view and closes it with Escape', () => {
    const { container } = render(<GlassChartPanel title="Produção por célula"><div>Gráfico</div></GlassChartPanel>);

    fireEvent.click(screen.getByRole('button', { name: 'Expandir gráfico' }));
    expect(container.querySelector('.chart-glass-panel--expanded')).not.toBeNull();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('.chart-glass-panel--expanded')).toBeNull();
  });

  it('exposes the contextual options menu', () => {
    render(<GlassChartPanel title="Tendência"><div>Gráfico</div></GlassChartPanel>);

    fireEvent.click(screen.getByRole('button', { name: 'Mais opções do gráfico' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Abrir em tela ampliada' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Recolher dados' })).toBeInTheDocument();
  });
});
