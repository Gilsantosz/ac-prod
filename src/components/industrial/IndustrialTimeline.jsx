import React from 'react';
import { cn } from '@/lib/utils';
import IndustrialStatusBadge from './IndustrialStatusBadge';
import { Check, AlertCircle, Play, Circle } from 'lucide-react';

export default function IndustrialTimeline({
  steps = [],
  orientation = 'horizontal',
  currentStep,
  className
}) {
  if (!steps || steps.length === 0) return null;

  // Icones por status
  const getStepIcon = (status, isActive) => {
    if (isActive) return <Play className="w-3.5 h-3.5 fill-current text-white shrink-0" />;
    switch (status) {
      case 'completed':
        return <Check className="w-4 h-4 text-white shrink-0 font-bold" />;
      case 'rejected':
      case 'blocked':
        return <AlertCircle className="w-4 h-4 text-white shrink-0" />;
      default:
        return <Circle className="w-3 h-3 text-muted-foreground/60 shrink-0" />;
    }
  };

  const stepBorderColors = {
    completed: 'border-green-500 bg-green-500 text-white',
    active: 'border-emerald-500 bg-emerald-500 text-white shadow-md shadow-emerald-500/25 animate-pulse',
    rejected: 'border-red-500 bg-red-500 text-white',
    blocked: 'border-red-500 bg-red-500 text-white',
    skipped: 'border-slate-300 dark:border-slate-800 bg-slate-100 dark:bg-zinc-800 text-slate-500',
    pending: 'border-slate-200 dark:border-slate-800 bg-card text-muted-foreground'
  };

  // Horizontal Mode
  if (orientation === 'horizontal') {
    return (
      <div className={cn('w-full overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-border', className)}>
        <div className="flex items-start min-w-[640px] px-4 py-2">
          {steps.map((step, idx) => {
            const isActive = step.key === currentStep || step.status === 'active';
            const isCompleted = step.status === 'completed';
            const isLast = idx === steps.length - 1;
            const statusKey = isActive ? 'active' : step.status || 'pending';

            return (
              <div key={step.key || idx} className={cn('flex flex-col flex-1 relative items-center')}>
                {/* Linha Conectora */}
                {!isLast && (
                  <div
                    className={cn(
                      'absolute top-5 left-[50%] right-[-50%] h-0.5 z-0',
                      isCompleted 
                        ? 'bg-gradient-to-r from-green-500 to-green-300 dark:to-green-700' 
                        : 'bg-border/60'
                    )}
                  />
                )}

                {/* Marcador Círculo */}
                <div
                  className={cn(
                    'w-10 h-10 rounded-full border-2 flex items-center justify-center z-10 shrink-0 bg-card',
                    stepBorderColors[statusKey] || stepBorderColors.pending
                  )}
                >
                  {getStepIcon(step.status, isActive)}
                </div>

                {/* Conteúdo Textual */}
                <div className="text-center mt-3 px-2 max-w-[150px] space-y-1">
                  <p className={cn('text-xs font-bold truncate leading-tight', isActive ? 'text-foreground font-black' : 'text-muted-foreground')}>
                    {step.label}
                  </p>
                  {step.description && (
                    <p className="text-[10px] text-muted-foreground truncate leading-normal">
                      {step.description}
                    </p>
                  )}
                  {step.meta && (
                    <p className="text-[9px] font-mono text-[#2d9c4a] truncate font-semibold">
                      {step.meta}
                    </p>
                  )}
                  <div className="pt-1 flex justify-center scale-90 origin-top">
                    <IndustrialStatusBadge status={step.status || 'pending'} size="sm" />
                  </div>
                </div>

              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Vertical Mode
  return (
    <div className={cn('flex flex-col space-y-5', className)}>
      {steps.map((step, idx) => {
        const isActive = step.key === currentStep || step.status === 'active';
        const isLast = idx === steps.length - 1;
        const statusKey = isActive ? 'active' : step.status || 'pending';

        return (
          <div key={step.key || idx} className="flex gap-4 relative items-start">
            {/* Linha Conectora Vertical */}
            {!isLast && (
              <div
                className={cn(
                  'absolute top-10 left-5 bottom-[-20px] w-0.5 z-0',
                  step.status === 'completed' ? 'bg-green-500' : 'bg-border/60'
                )}
              />
            )}

            {/* Marcador Círculo */}
            <div
              className={cn(
                'w-10 h-10 rounded-full border-2 flex items-center justify-center z-10 shrink-0 bg-card',
                stepBorderColors[statusKey] || stepBorderColors.pending
              )}
            >
              {getStepIcon(step.status, isActive)}
            </div>

            {/* Conteúdo Textual Lateral */}
            <div className="flex-1 space-y-1 pt-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap justify-between">
                <h4 className={cn('text-sm font-bold truncate', isActive ? 'text-foreground font-black' : 'text-foreground/90')}>
                  {step.label}
                </h4>
                <IndustrialStatusBadge status={step.status || 'pending'} size="sm" />
              </div>
              
              {step.description && (
                <p className="text-xs text-muted-foreground leading-normal">
                  {step.description}
                </p>
              )}
              {step.meta && (
                <p className="text-[10px] font-mono text-[#2d9c4a] font-semibold">
                  {step.meta}
                </p>
              )}
            </div>

          </div>
        );
      })}
    </div>
  );
}
