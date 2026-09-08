import { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical, EyeOff, Columns2, Square, ArrowUp, ArrowDown, MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

/**
 * SortablePanels — Grade de 2 colunas com DnD para reordenar,
 * controles encapsulados de visibilidade e redimensionamento por painel.
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

  const movePanel = (index, delta) => {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= ordered.length) return;
    const ids = ordered.map((p) => p.id);
    [ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]];
    onReorder(ids);
  };

  // Controles encapsulados posicionados no topo direito de cada cartão
  function PanelControls({ panel, index, dragHandleProps }) {
    if (!editable) return null;
    const size = sizes[panel.id] || 'full';
    const canMoveUp = index > 0;
    const canMoveDown = index < ordered.length - 1;

    return (
      <div
        className="flex items-center gap-1 p-1 rounded-xl bg-background/80 dark:bg-card/85 backdrop-blur-md border border-border/50 shadow-sm"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label={`Mover para cima: ${panel.title || panel.id}`}
          title="Mover para cima"
          disabled={!canMoveUp}
          onClick={() => movePanel(index, -1)}
          className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors disabled:opacity-25 disabled:pointer-events-none"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          aria-label={`Mover para baixo: ${panel.title || panel.id}`}
          title="Mover para baixo"
          disabled={!canMoveDown}
          onClick={() => movePanel(index, 1)}
          className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors disabled:opacity-25 disabled:pointer-events-none"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>

        {onToggleSize && (
          <button
            type="button"
            onClick={() => onToggleSize(panel.id)}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"
            title={size === 'half' ? 'Expandir para largura total' : 'Dividir em meia largura'}
          >
            {size === 'half' ? (
              <Square className="h-3.5 w-3.5" />
            ) : (
              <Columns2 className="h-3.5 w-3.5" />
            )}
          </button>
        )}

        {onToggleHide && (
          <button
            type="button"
            onClick={() => onToggleHide(panel.id)}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"
            title="Ocultar este painel"
          >
            <EyeOff className="h-3.5 w-3.5" />
          </button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"
              title="Mais opções do painel"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 bg-card/95 backdrop-blur-md">
            {canMoveUp && (
              <DropdownMenuItem onClick={() => movePanel(index, -1)}>
                <ArrowUp className="h-4 w-4 mr-2" /> Mover para cima
              </DropdownMenuItem>
            )}
            {canMoveDown && (
              <DropdownMenuItem onClick={() => movePanel(index, 1)}>
                <ArrowDown className="h-4 w-4 mr-2" /> Mover para baixo
              </DropdownMenuItem>
            )}
            {onToggleSize && (
              <DropdownMenuItem onClick={() => onToggleSize(panel.id)}>
                {size === 'half' ? (
                  <>
                    <Square className="h-4 w-4 mr-2" /> Expandir largura
                  </>
                ) : (
                  <>
                    <Columns2 className="h-4 w-4 mr-2" /> Dividir largura
                  </>
                )}
              </DropdownMenuItem>
            )}
            {onToggleHide && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onToggleHide(panel.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <EyeOff className="h-4 w-4 mr-2" /> Ocultar painel
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {dragHandleProps && (
          <div
            {...dragHandleProps}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors cursor-grab active:cursor-grabbing"
            title="Arrastar para reposicionar"
          >
            <GripVertical className="h-3.5 w-3.5" />
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
        {ordered.map((panel, index) => (
          <div key={panel.id} className={`group/panel relative min-w-0 ${colClass(panel.id)}`}>
            {editable && (
              <div className="absolute top-4 right-4 z-20 opacity-90 group-hover/panel:opacity-100 transition-opacity">
                <PanelControls panel={panel} index={index} />
              </div>
            )}
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
              <Draggable isDragDisabled={!editable} key={panel.id} draggableId={panel.id} index={index}>
                {(prov, snapshot) => (
                  <div
                    ref={prov.innerRef}
                    {...prov.draggableProps}
                    className={`group/panel relative min-w-0 ${colClass(panel.id)} ${snapshot.isDragging ? 'z-50' : ''}`}
                  >
                    {editable && (
                      <div className="absolute top-4 right-4 z-20 opacity-90 group-hover/panel:opacity-100 transition-opacity">
                        <PanelControls panel={panel} index={index} dragHandleProps={prov.dragHandleProps} />
                      </div>
                    )}
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