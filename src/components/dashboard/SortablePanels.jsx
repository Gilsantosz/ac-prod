import { useEffect, useRef, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  ArrowLeft,
  ArrowRight,
  Columns2,
  EyeOff,
  GripVertical,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Square,
} from 'lucide-react';

/**
 * Grade modular dos painéis do dashboard.
 * Mantém DnD, ordenação por teclado, largura configurável, ocultação e expansão.
 */
export default function SortablePanels({
  panels,
  order,
  sizes = {},
  onReorder,
  onToggleHide,
  onToggleSize,
  editable = true,
}) {
  const [ready, setReady] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const menuRootRef = useRef(null);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    if (!expandedId) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setExpandedId(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [expandedId]);

  useEffect(() => {
    if (!openMenuId) return undefined;
    const closeMenu = (event) => {
      if (!menuRootRef.current?.contains(event.target)) setOpenMenuId(null);
    };
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, [openMenuId]);

  const ordered = order
    .map((id) => panels.find((panel) => panel.id === id))
    .filter(Boolean);

  const movePanel = (index, delta) => {
    const destination = index + delta;
    if (destination < 0 || destination >= ordered.length) return;
    const ids = ordered.map((panel) => panel.id);
    [ids[index], ids[destination]] = [ids[destination], ids[index]];
    onReorder(ids);
  };

  const handleDragEnd = (result) => {
    if (!result.destination || result.source.index === result.destination.index) return;
    const ids = ordered.map((panel) => panel.id);
    const [moved] = ids.splice(result.source.index, 1);
    ids.splice(result.destination.index, 0, moved);
    onReorder(ids);
  };

  function PanelControls({ panel, index, dragHandleProps }) {
    if (!editable) return null;
    const size = sizes[panel.id] || 'full';
    const expanded = expandedId === panel.id;
    const menuOpen = openMenuId === panel.id;

    return (
      <div className="dashboard-panel-controls" aria-label={`Controles de ${panel.title || 'painel'}`}>
        <button
          type="button"
          className="dashboard-panel-control"
          aria-label={`Mover ${panel.title || 'painel'} para a esquerda`}
          title="Mover para a esquerda"
          disabled={index === 0}
          onClick={() => movePanel(index, -1)}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          className="dashboard-panel-control"
          aria-label={`Mover ${panel.title || 'painel'} para a direita`}
          title="Mover para a direita"
          disabled={index === ordered.length - 1}
          onClick={() => movePanel(index, 1)}
        >
          <ArrowRight aria-hidden="true" />
        </button>
        <button
          type="button"
          className="dashboard-panel-control"
          aria-label={expanded ? `Reduzir ${panel.title || 'painel'}` : `Expandir ${panel.title || 'painel'}`}
          title={expanded ? 'Reduzir' : 'Expandir'}
          onClick={() => setExpandedId(expanded ? null : panel.id)}
        >
          {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="dashboard-panel-control"
          aria-label={`Ocultar ${panel.title || 'painel'}`}
          title="Ocultar painel"
          onClick={() => onToggleHide?.(panel.id)}
        >
          <EyeOff aria-hidden="true" />
        </button>
        <div className="relative" ref={menuOpen ? menuRootRef : undefined}>
          <button
            type="button"
            className="dashboard-panel-control"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Mais opções de ${panel.title || 'painel'}`}
            title="Mais opções"
            onClick={() => setOpenMenuId(menuOpen ? null : panel.id)}
          >
            <MoreHorizontal aria-hidden="true" />
          </button>
          {menuOpen && (
            <div className="dashboard-panel-menu" role="menu">
              {onToggleSize && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onToggleSize(panel.id);
                    setOpenMenuId(null);
                  }}
                >
                  {size === 'half' ? 'Usar largura total' : 'Usar meia largura'}
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setExpandedId(expanded ? null : panel.id);
                  setOpenMenuId(null);
                }}
              >
                {expanded ? 'Sair da tela ampliada' : 'Abrir em tela ampliada'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onToggleHide?.(panel.id);
                  setOpenMenuId(null);
                }}
              >
                Ocultar este painel
              </button>
              <p>Também é possível arrastar o painel pelo ícone de movimentação.</p>
            </div>
          )}
        </div>
        {dragHandleProps && (
          <button
            type="button"
            {...dragHandleProps}
            className="dashboard-panel-control cursor-grab active:cursor-grabbing"
            aria-label={`Arrastar ${panel.title || 'painel'} para reposicionar`}
            title="Arrastar para reposicionar"
          >
            <GripVertical aria-hidden="true" />
          </button>
        )}
        <span className="sr-only">{size === 'half' ? 'Meia largura' : 'Largura total'}</span>
      </div>
    );
  }

  function colClass(id) {
    return (sizes[id] || 'full') === 'half' ? 'col-span-1' : 'col-span-1 md:col-span-2';
  }

  const renderPanel = (panel, index, provided, snapshot = {}) => {
    const expanded = expandedId === panel.id;
    return (
      <div
        ref={provided?.innerRef}
        {...provided?.draggableProps}
        className={`dashboard-panel-shell group relative min-w-0 ${colClass(panel.id)} ${snapshot.isDragging ? 'z-50' : ''} ${expanded ? 'dashboard-panel-shell--expanded' : ''}`}
      >
        {expanded && (
          <button
            type="button"
            className="chart-expanded-backdrop"
            aria-label={`Fechar ${panel.title || 'painel'} ampliado`}
            onClick={() => setExpandedId(null)}
          />
        )}
        <div className={`relative z-[92] ${snapshot.isDragging ? 'ring-2 ring-emerald-400 rounded-3xl shadow-2xl' : ''}`}>
          <PanelControls panel={panel} index={index} dragHandleProps={provided?.dragHandleProps} />
          {panel.node}
        </div>
      </div>
    );
  };

  if (!ready) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2">
        {ordered.map((panel, index) => (
          <div key={panel.id} className={`dashboard-panel-shell group relative min-w-0 ${colClass(panel.id)}`}>
            <PanelControls panel={panel} index={index} />
            {panel.node}
          </div>
        ))}
      </div>
    );
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <Droppable droppableId="dashboard-panels">
        {(provided) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2"
          >
            {ordered.map((panel, index) => (
              <Draggable isDragDisabled={!editable || expandedId === panel.id} key={panel.id} draggableId={panel.id} index={index}>
                {(dragProvided, snapshot) => renderPanel(panel, index, dragProvided, snapshot)}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}
