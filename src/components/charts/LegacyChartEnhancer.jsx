import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  MoreHorizontal,
} from 'lucide-react';

let legacyChartSequence = 0;

function findLegacyPanel(chartContainer) {
  if (chartContainer.closest('.chart-glass-panel, .dashboard-panel-shell')) return null;

  let current = chartContainer.parentElement;
  let fallback = null;
  let depth = 0;
  while (current && current !== document.body && depth < 8) {
    if (current.classList.contains('chart-glass-panel') || current.classList.contains('dashboard-panel-shell')) return null;
    if (!fallback && (current.tagName === 'ARTICLE' || current.classList.contains('rounded-2xl'))) fallback = current;
    if (current.classList.contains('bg-card')) return current;
    current = current.parentElement;
    depth += 1;
  }
  return fallback;
}

function getPanelId(panel) {
  if (!panel.dataset.legacyChartId) {
    legacyChartSequence += 1;
    panel.dataset.legacyChartId = `legacy-chart-${legacyChartSequence}`;
  }
  return panel.dataset.legacyChartId;
}

function LegacyChartControls({ panel, panels, index }) {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    panel.classList.add('legacy-chart-panel');
    return () => {
      panel.classList.remove('legacy-chart-panel', 'legacy-chart-panel--collapsed', 'legacy-chart-panel--expanded');
    };
  }, [panel]);

  useEffect(() => {
    panel.classList.toggle('legacy-chart-panel--collapsed', collapsed);
  }, [collapsed, panel]);

  useEffect(() => {
    panel.classList.toggle('legacy-chart-panel--expanded', expanded);
    if (!expanded) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [expanded, panel]);

  const goToPanel = (delta) => {
    const next = panels[index + delta];
    if (!next) return;
    next.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    next.setAttribute('tabindex', '-1');
    next.focus({ preventScroll: true });
  };

  return (
    <>
      {expanded && (
        <button
          type="button"
          className="chart-expanded-backdrop"
          aria-label="Fechar gráfico ampliado"
          onClick={() => setExpanded(false)}
        />
      )}
      <div className="legacy-chart-controls chart-panel-controls" aria-label="Controles do gráfico">
        <button type="button" className="chart-control-button" onClick={() => goToPanel(-1)} disabled={index === 0} aria-label="Ir para o gráfico anterior" title="Gráfico anterior">
          <ChevronLeft aria-hidden="true" />
        </button>
        <button type="button" className="chart-control-button" onClick={() => goToPanel(1)} disabled={index === panels.length - 1} aria-label="Ir para o próximo gráfico" title="Próximo gráfico">
          <ChevronRight aria-hidden="true" />
        </button>
        <button type="button" className="chart-control-button" onClick={() => setExpanded((value) => !value)} aria-label={expanded ? 'Reduzir gráfico' : 'Expandir gráfico'} title={expanded ? 'Reduzir' : 'Expandir'}>
          {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
        </button>
        <button type="button" className="chart-control-button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} aria-label={collapsed ? 'Mostrar gráfico' : 'Ocultar gráfico'} title={collapsed ? 'Mostrar' : 'Ocultar'}>
          {collapsed ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
        </button>
        <div className="relative">
          <button type="button" className="chart-control-button" onClick={() => setMenuOpen((value) => !value)} aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Mais opções do gráfico" title="Mais opções">
            <MoreHorizontal aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className="chart-panel-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setExpanded((value) => !value); setMenuOpen(false); }}>
                {expanded ? 'Sair da tela ampliada' : 'Abrir em tela ampliada'}
              </button>
              <button type="button" role="menuitem" onClick={() => { setCollapsed((value) => !value); setMenuOpen(false); }}>
                {collapsed ? 'Exibir dados' : 'Recolher dados'}
              </button>
              <p>Os valores também podem ser explorados por foco e pelas setas do teclado.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function LegacyChartEnhancer() {
  const [panels, setPanels] = useState([]);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined;

    let frame = 0;
    const scan = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const uniquePanels = [];
        const seen = new Set();
        document.querySelectorAll('.recharts-responsive-container').forEach((chartContainer) => {
          const panel = findLegacyPanel(chartContainer);
          if (!panel || seen.has(panel)) return;
          seen.add(panel);
          getPanelId(panel);
          uniquePanels.push(panel);
        });
        setPanels((current) => {
          const currentIds = current.map(getPanelId).join('|');
          const nextIds = uniquePanels.map(getPanelId).join('|');
          return currentIds === nextIds ? current : uniquePanels;
        });
      });
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true });
    window.addEventListener('resize', scan);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', scan);
    };
  }, []);

  const stablePanels = useMemo(() => panels.filter((panel) => panel.isConnected), [panels]);

  return stablePanels.map((panel, index) => createPortal(
    <LegacyChartControls key={getPanelId(panel)} panel={panel} panels={stablePanels} index={index} />,
    panel,
  ));
}
