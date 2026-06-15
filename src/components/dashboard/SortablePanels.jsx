import { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical, EyeOff, Columns2, Square } from 'lucide-react';

/**
 * SortablePanels — Grade de 2 colunas com DnD para reordenar,
 * controles de visibilidade e redimensionamento por painel.
 *
 * Props:
 *   panels   : { id, node }[]     — todos os painéis disponíveis
 *   order    : string[]            — ids dos painéis visíveis em ordem
 *   sizes    : Record<string, 'full'|'half'>
 *   onReorder(ids): void
 *   onToggleHide(id): void
 *   onToggleSize(id): void
 */
export default function SortablePanels({
  panels,
  order,
  sizes = {},
  onReorder,
  onToggleHide,
  onToggleSize,
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  // Resolve a lista de painéis visíveis ordenados
  const ordered = order
    .map((id) => panels.find((p) => p.id === id))
    .filter(Boolean);

  const handleDragEnd = (result) => {
    if (!result.destination || result.source.index === result.destination.index) return;
    const ids = ordered.map((p) => p.id);
    const [moved] = ids.splice(result.source.index, 1);
    ids.splice(result.destination.index, 0, moved);
    onReorder(ids);
  };

  // Botões de controle flutuam acima do painel ao hover
  function PanelControls({ panel, dragHandleProps }) {
    const size = sizes[panel.id] || 'full';
    return (
      <div className="absolute -top-3 right-2 z-20 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-150 pointer-events-none group-hover:pointer-events-auto">
        {onToggleSize && (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onToggleSize(panel.id)}
            className="flex h-6 px-1.5 items-center gap-1 rounded-md border border-border bg-card text-[10px] font-medium text-muted-foreground shadow-sm hover:text-foreground hover:bg-secondary transition-colors"
            title={size === 'half' ? 'Expandir para largura total' : 'Dividir em meia largura'}
          >
            {size === 'half' ? (
              <><Square className="h-3 w-3" /><span className="hidden sm:inline">Expandir</span></>
            ) : (
              <><Columns2 className="h-3 w-3" /><span className="hidden sm:inline">Dividir</span></>
            )}
          </button>
        )}
        {onToggleHide && (
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onToggleHide(panel.id)}
            className="flex h-6 px-1.5 items-center gap-1 rounded-md border border-border bg-card text-[10px] font-medium text-muted-foreground shadow-sm hover:text-foreground hover:bg-secondary transition-colors"
            title="Ocultar este painel"
          >
            <EyeOff className="h-3 w-3" /><span className="hidden sm:inline">Ocultar</span>
          </button>
        )}
        {dragHandleProps && (
          <div
            {...dragHandleProps}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm cursor-grab active:cursor-grabbing"
            title="Arrastar para reposicionar"
          >
            <GripVertical className="h-3 w-3" />
          </div>
        )}
      </div>
    );
  }

  function colClass(id) {
    return (sizes[id] || 'full') === 'half' ? 'col-span-1' : 'col-span-1 md:col-span-2';
  }

  // Renderização estática antes de montar o DnD (evita flash de layout)
  if (!ready) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {ordered.map((panel) => (
          <div key={panel.id} className={`group relative ${colClass(panel.id)}`}>
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
            className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6"
          >
            {ordered.map((panel, index) => (
              <Draggable key={panel.id} draggableId={panel.id} index={index}>
                {(prov, snapshot) => (
                  <div
                    ref={prov.innerRef}
                    {...prov.draggableProps}
                    className={`group relative ${colClass(panel.id)} ${snapshot.isDragging ? 'z-50' : ''}`}
                  >
                    <PanelControls panel={panel} dragHandleProps={prov.dragHandleProps} />
                    <div className={snapshot.isDragging ? 'ring-2 ring-sky-400 rounded-2xl shadow-2xl' : ''}>
                      {panel.node}
                    </div>
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}