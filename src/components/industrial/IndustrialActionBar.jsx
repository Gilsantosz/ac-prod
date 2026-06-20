import React from 'react';
import { cn } from '@/lib/utils';

export default function IndustrialActionBar({
  children,
  align = 'right',
  stickyMobile = false,
  className
}) {
  const alignmentStyles = {
    left: 'justify-start',
    right: 'justify-end',
    between: 'justify-between'
  };

  return (
    <div
      className={cn(
        'w-full flex items-center gap-3',
        alignmentStyles[align] || alignmentStyles.right,
        stickyMobile && [
          'fixed bottom-0 left-0 right-0 z-40 p-4 bg-background/95 dark:bg-zinc-950/95 backdrop-blur-md',
          'border-t border-border shadow-lg md:shadow-none md:border-t-0 md:p-0 md:relative md:z-auto',
          'md:bg-transparent md:backdrop-blur-none pb-[calc(1rem+env(safe-area-inset-bottom))]'
        ],
        className
      )}
    >
      {children}
    </div>
  );
}
