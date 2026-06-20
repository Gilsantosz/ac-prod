import React from 'react';
import { cn } from '@/lib/utils';

export default function IndustrialSectionCard({
  title,
  subtitle,
  icon: Icon,
  actions,
  children,
  className,
  variant = 'default',
  compact = false
}) {
  // Configuração das variantes visuais
  const variantStyles = {
    default: 'border-border/60 bg-card text-card-foreground',
    accent: 'border-emerald-500/20 dark:border-emerald-500/30 bg-emerald-50/5 dark:bg-emerald-950/5 text-foreground',
    warning: 'border-amber-500/20 dark:border-amber-500/30 bg-amber-50/5 dark:bg-amber-950/5 text-foreground',
    danger: 'border-red-500/20 dark:border-red-500/30 bg-red-50/5 dark:bg-red-950/5 text-foreground',
    success: 'border-green-500/20 dark:border-green-500/30 bg-green-50/5 dark:bg-green-950/5 text-foreground',
    muted: 'border-border/40 bg-secondary/15 text-muted-foreground'
  };

  const borderAccentStyles = {
    default: '',
    accent: 'before:absolute before:top-0 before:bottom-0 before:left-0 before:w-1 before:bg-emerald-500 before:rounded-l-3xl',
    warning: 'before:absolute before:top-0 before:bottom-0 before:left-0 before:w-1 before:bg-amber-500 before:rounded-l-3xl',
    danger: 'before:absolute before:top-0 before:bottom-0 before:left-0 before:w-1 before:bg-red-500 before:rounded-l-3xl',
    success: 'before:absolute before:top-0 before:bottom-0 before:left-0 before:w-1 before:bg-green-500 before:rounded-l-3xl',
    muted: 'before:absolute before:top-0 before:bottom-0 before:left-0 before:w-1 before:bg-muted-foreground/30 before:rounded-l-3xl'
  };

  const hasHeader = title || subtitle || Icon || actions;

  return (
    <div
      className={cn(
        'relative rounded-3xl border shadow-sm overflow-hidden transition-all',
        variantStyles[variant] || variantStyles.default,
        borderAccentStyles[variant] || borderAccentStyles.default,
        className
      )}
    >
      {/* Header do Card */}
      {hasHeader && (
        <div
          className={cn(
            'flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/40',
            compact ? 'px-4 py-3' : 'px-5 py-4 sm:px-6'
          )}
        >
          <div className="flex items-center gap-3 min-w-0">
            {Icon && (
              <div
                className={cn(
                  'p-2 rounded-xl shrink-0 flex items-center justify-center',
                  variant === 'default' ? 'bg-secondary/40 text-muted-foreground' : 'bg-background/80 text-foreground'
                )}
              >
                <Icon className="w-4 h-4 text-inherit" />
              </div>
            )}
            <div className="min-w-0">
              {title && (
                <h3 className="font-bold text-sm sm:text-base text-foreground truncate">
                  {title}
                </h3>
              )}
              {subtitle && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {actions && (
            <div className="flex items-center gap-2 shrink-0">
              {actions}
            </div>
          )}
        </div>
      )}

      {/* Conteúdo do Card */}
      <div className={cn(compact ? 'p-4' : 'p-5 sm:p-6')}>
        {children}
      </div>
    </div>
  );
}
