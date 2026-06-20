import React from 'react';
import { cn } from '@/lib/utils';

export default function IndustrialPageShell({
  children,
  className,
  maxWidth = 'max-w-7xl',
  spacing = 'space-y-5 sm:space-y-6'
}) {
  return (
    <div
      className={cn(
        'w-full mx-auto p-4 sm:p-6 lg:p-8',
        maxWidth,
        spacing,
        className
      )}
    >
      {children}
    </div>
  );
}
