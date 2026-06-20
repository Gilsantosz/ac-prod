import React, { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Barcode, Camera, Keyboard, RadioTower, X, ArrowRight } from 'lucide-react';

export default function IndustrialScannerInput({
  value = '',
  onChange = null,
  onSubmit = null,
  placeholder = 'Aponte o leitor ou digite o código...',
  mode = 'keyboard', // keyboard | camera | manual | rfid
  autoFocus = true,
  disabled = false,
  status = 'neutral', // success | warning | danger | info | neutral
  helper,
  className
}) {
  const inputRef = useRef(null);

  // Configurações visuais por status
  const statusStyles = {
    neutral: 'border-border focus:ring-[#2d9c4a]/20 focus:border-[#2d9c4a]',
    success: 'border-green-500/70 focus:ring-green-500/20 focus:border-green-500 text-green-800 dark:text-green-300 bg-green-500/5',
    warning: 'border-amber-500/70 focus:ring-amber-500/20 focus:border-amber-500 text-amber-800 dark:text-amber-300 bg-amber-500/5',
    danger: 'border-red-500/70 focus:ring-red-500/20 focus:border-red-500 text-red-800 dark:text-red-300 bg-red-500/5',
    info: 'border-blue-500/70 focus:ring-blue-500/20 focus:border-blue-500 text-blue-800 dark:text-blue-300 bg-blue-500/5'
  };

  const helperTextColors = {
    neutral: 'text-muted-foreground',
    success: 'text-green-600 dark:text-green-400',
    warning: 'text-amber-600 dark:text-amber-400',
    danger: 'text-red-600 dark:text-red-400',
    info: 'text-blue-600 dark:text-blue-400'
  };

  // Ícones do modo
  const modeIcons = {
    keyboard: Barcode, // Padrão leitor de mão USB
    camera: Camera,    // Câmera mobile
    manual: Keyboard,  // Digitação manual de contingência
    rfid: RadioTower   // RFID em lote
  };

  const ModeIcon = modeIcons[mode] || Barcode;

  const modeLabels = {
    keyboard: 'Scanner USB Físico',
    camera: 'Câmera do Celular',
    manual: 'Teclado Manual',
    rfid: 'Leitor RFID'
  };

  // Garante autoFocus após renderizações ou cliques
  useEffect(() => {
    if (autoFocus && inputRef.current && !disabled) {
      inputRef.current.focus();
    }
  }, [autoFocus, disabled, mode]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && onSubmit) {
      e.preventDefault();
      onSubmit(value);
    }
  };

  return (
    <div className={cn('w-full space-y-1.5', className)}>
      
      {/* Rótulo superior do modo */}
      <div className="flex items-center justify-between text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1">
        <span className="flex items-center gap-1.5">
          <ModeIcon className="w-3.5 h-3.5 text-[#2d9c4a]" />
          Modo Ativo: <strong className="text-foreground">{modeLabels[mode]}</strong>
        </span>
        {autoFocus && !disabled && (
          <span className="text-emerald-600 dark:text-emerald-400 animate-pulse text-[9px]">
            ● Foco Automático Ativo
          </span>
        )}
      </div>

      {/* Input de Coleta */}
      <div className="relative flex items-center">
        
        {/* Ícone Lateral Interno */}
        <div className="absolute left-3.5 text-muted-foreground shrink-0 pointer-events-none">
          <ModeIcon className="w-5 h-5 text-inherit" />
        </div>

        {/* Input Text */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck="false"
          className={cn(
            'w-full h-14 pl-12 pr-24 rounded-2xl border text-base font-semibold',
            'bg-background placeholder:text-muted-foreground/60 transition-all focus:outline-none focus:ring-4',
            statusStyles[status] || statusStyles.neutral,
            disabled && 'opacity-65 cursor-not-allowed bg-secondary/30'
          )}
        />

        {/* Ações Internas do Campo */}
        <div className="absolute right-2 flex items-center gap-1 shrink-0">
          
          {/* Botão de Limpar */}
          {value && !disabled && (
            <button
              type="button"
              onClick={() => onChange?.('')}
              className="p-2 rounded-xl text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          {/* Botão de Confirmação Rápida */}
          <button
            type="button"
            disabled={!value || disabled}
            onClick={() => onSubmit?.(value)}
            className={cn(
              'px-3 h-10 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 text-[#2d9c4a] transition-all font-bold text-xs gap-1 flex items-center justify-center shrink-0 border border-emerald-500/20',
              (!value || disabled) && 'opacity-50 cursor-not-allowed hover:bg-emerald-500/15'
            )}
          >
            <span>Scan</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

        </div>

      </div>

      {/* Texto Auxiliar ou de Feedback */}
      {helper && (
        <p className={cn('text-[11px] font-semibold leading-normal px-1', helperTextColors[status] || helperTextColors.neutral)}>
          {helper}
        </p>
      )}

    </div>
  );
}
