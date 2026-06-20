import React from 'react';
import { cn } from '@/lib/utils';

export default function IndustrialMetricGrid({
  children,
  columns = 4,
  className
}) {
  const columnStyles = {
    2: 'md:grid-cols-2 lg:grid-cols-2',
    3: 'md:grid-cols-3 lg:grid-cols-3',
    4: 'md:grid-cols-4 lg:grid-cols-4',
    5: 'md:grid-cols-5 lg:grid-cols-5'
  };

  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-4 w-full',
        columnStyles[columns] || columnStyles[4],
        // No celular compacto, pode colapsar para 1 coluna se a largura for muito pequena, mas grid-cols-2 atende a maioria.
        // Adicionando um colapso dinâmico opcional.
        'grid-cols-1 sm:grid-cols-2',
        className
      )}
    >
      {children}
    </div>
  );
}
