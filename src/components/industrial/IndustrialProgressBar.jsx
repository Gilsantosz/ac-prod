import React from 'react';
import { cn } from '@/lib/utils';

export default function IndustrialProgressBar({
  value = 0,
  max = 100,
  label,
  helper,
  status = 'neutral',
  showPercent = true,
  className
}) {
  const numericValue = Number(value) || 0;
  const numericMax = Number(max) || 100;
  
  // Calcula percentual limitado entre 0 e 100
  const rawPercent = numericMax > 0 ? (numericValue / numericMax) * 100 : 0;
  const percent = Math.min(100, Math.max(0, Math.round(rawPercent)));

  const progressColors = {
    neutral: 'bg-[#2d9c4a]',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-red-500',
    info: 'bg-blue-500'
  };

  const bgColors = {
    neutral: 'bg-secondary/60 dark:bg-zinc-800',
    success: 'bg-emerald-500/10 dark:bg-emerald-950/20',
    warning: 'bg-amber-500/10 dark:bg-amber-950/20',
    danger: 'bg-red-500/10 dark:bg-red-950/20',
    info: 'bg-blue-500/10 dark:bg-blue-950/20'
  };

  const currentProgressColor = progressColors[status] || progressColors.neutral;
  const currentBgColor = bgColors[status] || bgColors.neutral;

  return (
    <div className={cn('w-full space-y-1.5', className)}>
      
      {/* Rótulo superior */}
      {(label || showPercent) && (
        <div className="flex items-center justify-between text-[11px] font-bold text-muted-foreground uppercase tracking-wider px-0.5">
          <span>{label}</span>
          {showPercent && (
            <span className="font-mono text-foreground font-extrabold text-xs">
              {percent}%
            </span>
          )}
        </div>
      )}

      {/* Trilho da Barra */}
      <div className={cn('w-full h-3 rounded-full overflow-hidden border border-border/40 relative', currentBgColor)}>
        <div
          style={{ width: `${percent}%` }}
          className={cn('h-full rounded-full transition-all duration-500 ease-out', currentProgressColor)}
        />
      </div>

      {/* Texto de suporte inferior */}
      {helper && (
        <div className="flex items-center justify-between text-[10px] text-muted-foreground font-semibold px-0.5">
          <span>{helper}</span>
          <span className="font-mono tabular-nums">
            {numericValue} / {numericMax}
          </span>
        </div>
      )}

    </div>
  );
}
