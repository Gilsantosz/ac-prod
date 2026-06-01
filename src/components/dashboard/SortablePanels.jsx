import { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical } from 'lucide-react';

// panels: { id, node }[] na ordem atual. onReorder recebe a nova lista de ids.
export default function SortablePanels({ panels, order, onReorder, gap = 'space-y-6' }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

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

  // Previne erros de "removeChild" no ciclo de montagem do React 18 com @hello-pangea/dnd
  if (!ready) {
    return (
      <div className={gap}>
        {ordered.map((panel) => (
          <div key={panel.id} className="relative bg-card rounded-2xl border border-border/50">
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
          <div ref={provided.innerRef} {...provided.droppableProps} className={gap}>
            {ordered.map((panel, index) => (
              <Draggable key={panel.id} draggableId={panel.id} index={index}>
                {(prov, snapshot) => (
                  <div
                    ref={prov.innerRef}
                    {...prov.draggableProps}
                    className={`group relative ${snapshot.isDragging ? 'z-50' : ''}`}
                  >
                    <div
                      {...prov.dragHandleProps}
                      title="Arraste para reposicionar"
                      className="absolute -left-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 cursor-grab active:cursor-grabbing"
                    >
                      <GripVertical className="h-4 w-4" />
                    </div>
                    <div className={snapshot.isDragging ? 'ring-2 ring-sky-400 rounded-2xl' : ''}>
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