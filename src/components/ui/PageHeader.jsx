import { cn } from '@/lib/utils';

/**
 * PageHeader — Cabeçalho premium padrão para todas as páginas.
 *
 * Props:
 *  - title:    string (obrigatório) — título principal
 *  - subtitle: string               — subtítulo/descrição
 *  - icon:     LucideIcon           — ícone opcional
 *  - actions:  ReactNode            — botões/ações à direita
 *  - className: string              — classes extras para o container
 */
export default function PageHeader({ title, subtitle, icon: Icon, actions, className }) {
  return (
    <header
      className={cn(
        'page-header animate-fade-up flex flex-col md:flex-row md:items-center md:justify-between gap-4',
        className
      )}
    >
      {/* ── Orb de brilho decorativo ── */}
      <div className="absolute -top-8 -left-8 w-32 h-32 rounded-full bg-white/5 blur-2xl pointer-events-none" aria-hidden="true" />

      {/* ── Lado esquerdo: ícone + textos ── */}
      <div className="flex items-center gap-4 relative z-10 w-full md:w-auto">
        {Icon && (
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-white/10 border border-white/15 shrink-0">
            <Icon className="w-5 h-5 text-white/90" />
          </div>
        )}
        <div>
          <h1 className="title-gradient text-2xl sm:text-3xl font-extrabold leading-tight">
            {title}
          </h1>
          {subtitle && (
            <p className="text-white/60 text-sm mt-0.5 leading-relaxed">{subtitle}</p>
          )}
        </div>
      </div>

      {/* ── Lado direito: ações ── */}
      {actions && (
        <div className="flex flex-wrap items-center gap-2.5 relative z-10 w-full md:w-auto shrink-0">
          {actions}
        </div>
      )}
    </header>
  );
}
