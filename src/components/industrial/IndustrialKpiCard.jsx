import React from 'react';
import { cn } from '@/lib/utils';

export default function IndustrialKpiCard({
  label,
  value,
  helper,
  icon: Icon,
  status = 'neutral',
  trend,
  loading = false,
  className
}) {
  // Configuração das cores baseadas no status
  const statusColors = {
    neutral: 'text-foreground bg-card border-border/60',
    success: 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/5 border-emerald-500/25',
    warning: 'text-amber-700 dark:text-amber-400 bg-amber-500/5 border-amber-500/25',
    danger: 'text-red-700 dark:text-red-400 bg-red-500/5 border-red-500/25',
    info: 'text-blue-700 dark:text-blue-400 bg-blue-500/5 border-blue-500/25'
  };

  const iconBgColors = {
    neutral: 'bg-secondary/40 text-muted-foreground',
    success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    danger: 'bg-red-500/10 text-red-600 dark:text-red-400',
    info: 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
  };

  if (loading) {
    return (
      <div className={cn('rounded-2xl border p-4 sm:p-5 flex flex-col justify-between h-full min-h-[96px] bg-card animate-pulse border-border/40', className)}>
        <div className="flex items-center justify-between w-full">
          <div className="h-3 w-20 bg-muted rounded" />
          <div className="h-5 w-5 bg-muted rounded-md" />
        </div>
        <div className="mt-3 space-y-2">
          <div className="h-7 w-24 bg-muted rounded" />
          <div className="h-2.5 w-16 bg-muted rounded" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-2xl border p-4 sm:p-5 flex flex-col justify-between h-full min-h-[96px] transition-all hover:shadow-sm',
        statusColors[status] || statusColors.neutral,
        className
      )}
    >
      {/* Topo: Label e Ícone */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase font-bold tracking-wider opacity-85 truncate">
          {label}
        </span>
        {Icon && (
          <div className={cn('p-1.5 rounded-lg shrink-0 flex items-center justify-center', iconBgColors[status] || iconBgColors.neutral)}>
            <Icon className="w-3.5 h-3.5" />
          </div>
        )}
      </div>

      {/* Valor e rodapé */}
      <div className="mt-2 flex flex-col justify-end">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-none text-foreground">
            {value}
          </span>
          {trend && (
            <span className="text-xs font-bold whitespace-nowrap">
              {trend}
            </span>
          )}
        </div>
        {helper && (
          <span className="text-[10px] opacity-80 mt-1 truncate">
            {helper}
          </span>
        )}
      </div>
    </div>
  );
}
