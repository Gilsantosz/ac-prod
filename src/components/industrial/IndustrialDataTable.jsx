import React from 'react';
import { cn } from '@/lib/utils';
import IndustrialEmptyState from './IndustrialEmptyState';
import IndustrialStatusBadge from './IndustrialStatusBadge';
import { Inbox, Loader2 } from 'lucide-react';

export default function IndustrialDataTable({
  columns = [],
  data = [],
  loading = false,
  emptyTitle = 'Nenhum registro encontrado',
  emptyDescription = 'Não há dados correspondentes à seleção atual.',
  className,
  compact = false
}) {
  
  // Renderiza Célula individual com base nas propriedades da coluna
  const renderCell = (row, col) => {
    if (col.render) {
      return col.render(row);
    }
    const val = row[col.key];
    if (col.type === 'status') {
      return <IndustrialStatusBadge status={val} size="sm" />;
    }
    if (col.type === 'number') {
      return <span className="font-mono text-right block">{val != null ? val : '—'}</span>;
    }
    if (col.type === 'date') {
      return <span className="font-mono text-xs">{val ? new Date(val).toLocaleDateString('pt-BR') : '—'}</span>;
    }
    return val != null ? String(val) : '—';
  };

  // Renderiza Skeleton de carregamento
  if (loading) {
    return (
      <div className={cn('w-full border border-border/60 rounded-2xl bg-card overflow-hidden shadow-sm', className)}>
        <div className="p-4 border-b border-border/40 bg-secondary/20 flex items-center justify-between">
          <div className="h-4 w-32 bg-muted rounded animate-pulse" />
          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
        </div>
        <div className="p-4 space-y-3.5">
          {Array.from({ length: 4 }).map((_, rIdx) => (
            <div key={rIdx} className="flex items-center gap-4 py-1">
              <div className="h-7 w-12 bg-muted rounded animate-pulse shrink-0" />
              <div className="h-4 w-1/4 bg-muted rounded animate-pulse" />
              <div className="h-4 w-1/3 bg-muted rounded animate-pulse" />
              <div className="h-4 w-12 bg-muted rounded animate-pulse ml-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Renderiza Estado Vazio
  if (!data || data.length === 0) {
    return (
      <IndustrialEmptyState
        icon={Inbox}
        title={emptyTitle}
        description={emptyDescription}
        className={className}
      />
    );
  }

  return (
    <div className={cn('w-full border border-border/60 rounded-2xl bg-card overflow-hidden shadow-sm', className)}>
      
      {/* ── Desktop: Tabela Convencional ── */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-secondary/35 border-b border-border/60 text-xs font-semibold text-muted-foreground uppercase tracking-wider select-none">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'text-left font-bold px-4 py-3',
                    col.type === 'number' && 'text-right',
                    col.className
                  )}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/45">
            {data.map((row, rIdx) => (
              <tr
                key={row.id || rIdx}
                className="hover:bg-secondary/15 transition-colors text-foreground/90 font-medium"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      compact ? 'px-4 py-2.5 text-xs' : 'px-4 py-3 text-xs sm:text-sm',
                      col.type === 'number' && 'font-mono text-right',
                      col.className
                    )}
                  >
                    {renderCell(row, col)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile: Lista Adaptada em Cards ── */}
      <div className="block md:hidden divide-y divide-border/45">
        {data.map((row, rIdx) => (
          <div
            key={row.id || rIdx}
            className="p-4 flex flex-col gap-2 hover:bg-secondary/10 transition-colors"
          >
            {columns.map((col) => {
              const isActions = col.key === 'actions' || col.label === '';
              
              return (
                <div key={col.key} className={cn('flex justify-between items-start gap-3', isActions && 'pt-2 border-t border-border/30 mt-1')}>
                  {!isActions && (
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider pt-0.5 shrink-0">
                      {col.label}
                    </span>
                  )}
                  <div className={cn('text-xs text-foreground font-semibold text-right max-w-[65%]', isActions && 'w-full flex justify-end gap-1.5')}>
                    {renderCell(row, col)}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

    </div>
  );
}
