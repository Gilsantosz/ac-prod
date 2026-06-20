import React from 'react';
import { cn } from '@/lib/utils';

export default function IndustrialModeTabs({
  items = [],
  value,
  onChange = null,
  className
}) {
  if (!items || items.length === 0) return null;

  return (
    <div
      className={cn(
        'w-full overflow-x-auto pb-1 scrollbar-none flex gap-2 border-b border-border/40 select-none',
        className
      )}
    >
      <div className="flex items-center gap-1.5 min-w-max py-1 px-0.5">
        {items.map((item) => {
          const isActive = item.value === value;
          const Icon = item.icon;

          return (
            <button
              key={item.value}
              type="button"
              disabled={item.disabled}
              onClick={() => onChange?.(item.value)}
              className={cn(
                'flex flex-col sm:flex-row items-center sm:items-start gap-2 px-4 py-2.5 rounded-2xl border text-left transition-all shrink-0',
                isActive 
                  ? 'border-[#2d9c4a]/50 bg-[#76FB91]/8 dark:bg-emerald-950/15 text-[#2d9c4a] shadow-sm shadow-[#2d9c4a]/5 font-bold' 
                  : 'border-border/60 bg-card hover:bg-secondary/40 text-muted-foreground hover:text-foreground font-semibold',
                item.disabled && 'opacity-40 cursor-not-allowed hover:bg-card hover:text-muted-foreground'
              )}
            >
              {Icon && (
                <Icon
                  className={cn(
                    'w-4 h-4 shrink-0 mt-0.5',
                    isActive ? 'text-[#2d9c4a]' : 'text-inherit'
                  )}
                />
              )}
              <div className="min-w-0 flex flex-col items-center sm:items-start text-center sm:text-left">
                <span className="text-xs sm:text-sm whitespace-nowrap leading-tight">
                  {item.label}
                </span>
                {item.description && (
                  <span className="text-[9px] font-normal opacity-80 mt-0.5 hidden sm:block truncate max-w-[140px]">
                    {item.description}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
