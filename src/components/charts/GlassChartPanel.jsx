import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Eye, EyeOff, Maximize2, Minimize2, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function GlassChartPanel({
  title,
  subtitle,
  eyebrow,
  icon: Icon,
  children,
  className,
  contentClassName,
  controls = true,
  actions,
  defaultCollapsed = false,
  onCollapseChange,
  ariaLabel,
}) {
  const reduceMotion = useReducedMotion();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
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
  }, [expanded]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeMenu = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, [menuOpen]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    onCollapseChange?.(next);
  };

  const panel = (
    <motion.section
      layout={!reduceMotion}
      initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.992 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: reduceMotion ? 0 : 0.42, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'chart-glass-panel group/chart',
        expanded && 'chart-glass-panel--expanded',
        className,
      )}
      aria-label={ariaLabel || title}
    >
      <header className="chart-glass-panel__header">
        <div className="min-w-0">
          {eyebrow && <p className="chart-glass-panel__eyebrow">{eyebrow}</p>}
          <div className="flex min-w-0 items-center gap-2">
            {Icon && <Icon className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />}
            {title && <h3 className="chart-glass-panel__title">{title}</h3>}
          </div>
          {subtitle && <p className="chart-glass-panel__subtitle">{subtitle}</p>}
        </div>

        {(actions || controls) && (
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {controls && (
              <div className="chart-panel-controls" aria-label={`Controles de ${title || 'gráfico'}`}>
                <button
                  type="button"
                  className="chart-control-button"
                  onClick={() => setExpanded((value) => !value)}
                  aria-label={expanded ? 'Sair da visualização expandida' : 'Expandir gráfico'}
                  title={expanded ? 'Reduzir' : 'Expandir'}
                >
                  {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  className="chart-control-button"
                  onClick={toggleCollapsed}
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? 'Mostrar gráfico' : 'Ocultar gráfico'}
                  title={collapsed ? 'Mostrar' : 'Ocultar'}
                >
                  {collapsed ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
                </button>
                <div className="relative" ref={menuRef}>
                  <button
                    type="button"
                    className="chart-control-button"
                    onClick={() => setMenuOpen((value) => !value)}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    aria-label="Mais opções do gráfico"
                    title="Mais opções"
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </button>
                  <AnimatePresence>
                    {menuOpen && (
                      <motion.div
                        role="menu"
                        initial={reduceMotion ? false : { opacity: 0, y: -5, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
                        transition={{ duration: reduceMotion ? 0 : 0.16 }}
                        className="chart-panel-menu"
                      >
                        <button type="button" role="menuitem" onClick={() => { setExpanded((value) => !value); setMenuOpen(false); }}>
                          {expanded ? 'Reduzir painel' : 'Abrir em tela ampliada'}
                        </button>
                        <button type="button" role="menuitem" onClick={() => { toggleCollapsed(); setMenuOpen(false); }}>
                          {collapsed ? 'Exibir dados' : 'Recolher dados'}
                        </button>
                        <p>Use Tab, Enter e as setas do teclado para explorar os valores.</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="chart-content"
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reduceMotion ? { display: 'none' } : { opacity: 0, height: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.28, ease: 'easeOut' }}
            className={cn('chart-glass-panel__content', contentClassName)}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );

  return (
    <>
      {expanded && <button type="button" className="chart-expanded-backdrop" onClick={() => setExpanded(false)} aria-label="Fechar visualização expandida" />}
      {panel}
    </>
  );
}
