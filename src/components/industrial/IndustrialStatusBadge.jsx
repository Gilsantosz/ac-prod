import React from 'react';
import { cn } from '@/lib/utils';

export default function IndustrialStatusBadge({
  status = 'neutral',
  children,
  dot = false,
  size = 'md',
  className
}) {
  const norm = String(status).toLowerCase();

  // Mapeamento de status para cores
  const colorMap = {
    // Verde
    approved: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
    success: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
    online: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
    completed: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
    dentro_meta: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',
    valid: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20',

    // Amarelo
    warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
    pending: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
    attention: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
    etapa_errada: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
    baixa_eficiencia: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
    pending_review: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20',

    // Vermelho
    rejected: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
    blocked: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
    duplicated: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
    offline: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
    error: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
    danger: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',

    // Azul/Cinza Info
    info: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
    reading: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
    aguardando: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
    neutral: 'bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20',

    // Cinza Neutro
    cancelled: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20 line-through',
    reversed: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
    corrected: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20'
  };

  const dotColorMap = {
    approved: 'bg-green-500',
    success: 'bg-green-500',
    online: 'bg-green-500',
    completed: 'bg-green-500',
    dentro_meta: 'bg-green-500',
    valid: 'bg-green-500',

    warning: 'bg-amber-500',
    pending: 'bg-amber-500',
    attention: 'bg-amber-500',
    etapa_errada: 'bg-amber-500',
    baixa_eficiencia: 'bg-amber-500',
    pending_review: 'bg-purple-500',

    rejected: 'bg-red-500',
    blocked: 'bg-red-500',
    duplicated: 'bg-red-500',
    offline: 'bg-red-500',
    error: 'bg-red-500',
    danger: 'bg-red-500',

    info: 'bg-blue-500',
    reading: 'bg-blue-500',
    aguardando: 'bg-blue-500',
    neutral: 'bg-slate-500',

    cancelled: 'bg-slate-400',
    reversed: 'bg-slate-400',
    corrected: 'bg-sky-500'
  };

  const sizeStyles = {
    sm: 'text-[9px] px-1.5 py-0.5 gap-1',
    md: 'text-[10px] px-2.5 py-0.5 gap-1.5',
    lg: 'text-xs px-3.5 py-1 gap-2'
  };

  const dotSizeStyles = {
    sm: 'w-1 h-1',
    md: 'w-1.5 h-1.5',
    lg: 'w-2 h-2'
  };

  const currentStyles = colorMap[norm] || colorMap.neutral;
  const currentDotColor = dotColorMap[norm] || dotColorMap.neutral;

  // Tradução amigável
  const labelMap = {
    approved: 'Aprovado',
    success: 'Sucesso',
    online: 'Online',
    completed: 'Concluído',
    dentro_meta: 'Dentro da Meta',
    valid: 'Válido',
    warning: 'Atenção',
    pending: 'Pendente',
    attention: 'Atenção',
    etapa_errada: 'Etapa Errada',
    baixa_eficiencia: 'Baixa Eficiência',
    pending_review: 'Revisão',
    rejected: 'Rejeitado',
    blocked: 'Bloqueado',
    duplicated: 'Duplicado',
    offline: 'Offline',
    error: 'Erro',
    danger: 'Perigo',
    info: 'Info',
    reading: 'Lendo',
    aguardando: 'Aguardando',
    neutral: 'Neutro',
    cancelled: 'Cancelado',
    reversed: 'Estornado',
    corrected: 'Corrigido'
  };

  const displayLabel = children || labelMap[norm] || status;

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center font-semibold rounded-full border leading-tight whitespace-nowrap',
        currentStyles,
        sizeStyles[size] || sizeStyles.md,
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            'rounded-full shrink-0',
            currentDotColor,
            dotSizeStyles[size] || dotSizeStyles.md
          )}
        />
      )}
      {displayLabel}
    </span>
  );
}
