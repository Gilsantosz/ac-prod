import { cn } from '@/lib/utils';

/**
 * PageHeader — Cabeçalho minimalista de alta fidelidade para todas as páginas.
 */
export default function PageHeader({ title, subtitle = '', icon: Icon = null, actions = null, className = '' }) {
  return (
    <header
      className={cn(
        'page-header animate-fade-up flex flex-col xl:flex-row xl:items-end xl:justify-between gap-4 py-4 md:py-6',
        className
      )}
    >
      {/* Lado esquerdo: título e subtítulo */}
      <div className="flex items-center gap-4 relative z-10 w-full xl:w-auto">
        {Icon && (
          <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-card border border-border/80 text-foreground shadow-sm shrink-0">
            <Icon className="w-5.5 h-5.5" />
          </div>
        )}
        <div>
          {subtitle && (
            <p className="text-xs text-muted-foreground font-bold uppercase tracking-widest mb-1 leading-none">{subtitle}</p>
          )}
          <h1 className="text-3xl sm:text-4xl font-extrabold leading-tight text-foreground tracking-tight select-none">
            {title}
          </h1>
        </div>
      </div>

      {/* Lado direito: ações e filtros */}
      {actions && (
        <div className="flex flex-wrap items-center gap-2.5 relative z-10 w-full xl:w-auto shrink-0">
          {actions}
        </div>
      )}
    </header>
  );
}
