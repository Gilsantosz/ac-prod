import React from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

export default function IndustrialMobileFooterAction({
  primaryLabel,
  onPrimary = null,
  secondaryLabel,
  onSecondary = null,
  disabled = false,
  loading = false,
  children,
  className
}) {
  const hasPrimary = !!primaryLabel && !!onPrimary;
  const hasSecondary = !!secondaryLabel && !!onSecondary;
  const hasActions = hasPrimary || hasSecondary || children;

  if (!hasActions) return null;

  return (
    <div
      className={cn(
        // Mobile Layout: Sticky bottom
        'fixed bottom-0 left-0 right-0 z-40 p-4 bg-background/95 dark:bg-zinc-950/95 backdrop-blur-md',
        'border-t border-border shadow-lg md:shadow-none md:border-t-0 md:p-0 md:relative md:z-auto',
        'md:bg-transparent md:backdrop-blur-none pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-0',
        className
      )}
    >
      <div className="w-full max-w-7xl mx-auto flex gap-3.5">
        {/* Slot Children Customizado */}
        {children}

        {/* Botão Secundário */}
        {hasSecondary && !children && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled || loading}
            onClick={onSecondary}
            className="flex-1 md:flex-initial h-11 px-5 rounded-xl text-xs sm:text-sm font-semibold border-border bg-card"
          >
            {secondaryLabel}
          </Button>
        )}

        {/* Botão Principal */}
        {hasPrimary && !children && (
          <Button
            type="button"
            disabled={disabled || loading}
            onClick={onPrimary}
            className="flex-[2] md:flex-initial h-11 px-8 rounded-xl text-xs sm:text-sm font-bold bg-[#2d9c4a] hover:bg-[#237d3a] text-white shadow-md shadow-emerald-700/10 shrink-0"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : primaryLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
