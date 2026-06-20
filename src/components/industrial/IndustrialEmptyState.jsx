import React from 'react';
import { cn } from '@/lib/utils';
import { HelpCircle } from 'lucide-react';

export default function IndustrialEmptyState({
  icon: Icon = HelpCircle,
  title = 'Nenhum dado encontrado',
  description = 'Não há registros disponíveis para visualização no momento.',
  action,
  className
}) {
  return (
    <div
      className={cn(
        'w-full flex flex-col items-center justify-center text-center p-8 sm:p-12',
        'border border-dashed border-border/70 rounded-3xl bg-secondary/10 dark:bg-zinc-900/5',
        className
      )}
    >
      {/* Container de ícone */}
      <div className="w-12 h-12 rounded-2xl bg-secondary/60 text-muted-foreground flex items-center justify-center mb-4">
        <Icon className="w-6 h-6 text-inherit" />
      </div>

      {/* Textos */}
      <h3 className="text-sm sm:text-base font-bold text-foreground max-w-md">
        {title}
      </h3>
      <p className="text-xs text-muted-foreground max-w-sm mt-1 mb-5 leading-normal">
        {description}
      </p>

      {/* Ação */}
      {action && (
        <div className="flex items-center justify-center shrink-0">
          {action}
        </div>
      )}
    </div>
  );
}
