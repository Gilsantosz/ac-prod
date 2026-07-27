/**
 * OperationModePrompt — Leo Flow
 * Modal de orientação exibido na primeira abertura como PWA standalone.
 * Convida o operador a ativar o Modo Operação (fullscreen) para ocultar
 * os controles externos do navegador durante o uso industrial.
 */

import { useState, useEffect } from 'react';
import { Maximize2, X } from 'lucide-react';
import { detectDisplayMode } from '@/hooks/useFullscreenMode';

const STORAGE_KEY = 'lf_operation_mode_prompt_dismissed';

export default function OperationModePrompt({ onEnterFullscreen }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Só exibe em PWA standalone (não em aba comum e não no Electron)
    const mode = detectDisplayMode();
    const isPwa = mode === 'standalone' || mode === 'window-controls-overlay';
    if (!isPwa) return;

    // Não exibe se já foi descartado pelo usuário
    try {
      if (localStorage.getItem(STORAGE_KEY) === 'true') return;
    } catch { /* noop */ }

    // Pequeno atraso para não competir com o carregamento da tela
    const timer = setTimeout(() => setVisible(true), 1800);
    return () => clearTimeout(timer);
  }, []);

  function handleDismiss() {
    setVisible(false);
  }

  function handleDismissForever() {
    try { localStorage.setItem(STORAGE_KEY, 'true'); } catch { /* noop */ }
    setVisible(false);
  }

  function handleEnter() {
    onEnterFullscreen?.();
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ativar Modo Operação"
      className="fixed bottom-4 right-4 z-[9999] w-[340px] max-w-[calc(100vw-2rem)]
                 rounded-2xl border border-[#005f2f]/30 bg-card shadow-2xl
                 p-5 flex flex-col gap-3 animate-in slide-in-from-bottom-4 fade-in duration-300"
    >
      {/* Fechar */}
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center
                   rounded-full hover:bg-secondary transition-colors text-muted-foreground"
        aria-label="Fechar"
      >
        <X className="w-4 h-4" />
      </button>

      {/* Ícone + Título */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#005f2f] flex items-center justify-center shrink-0">
          <Maximize2 className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="font-bold text-sm text-foreground leading-tight">Modo Operação disponível</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Oculta os controles do navegador</p>
        </div>
      </div>

      {/* Descrição */}
      <p className="text-xs text-muted-foreground leading-relaxed">
        Para utilizar o Leo Flow sem os controles do Chrome, ative o{' '}
        <strong className="text-foreground">Modo Operação</strong>. A tela
        cheia oculta a barra de pesquisa, extensões e menu do navegador.
      </p>

      {/* Ações */}
      <div className="flex flex-col gap-2">
        <button
          onClick={handleEnter}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5
                     rounded-xl bg-[#005f2f] hover:bg-[#004a24] active:scale-95
                     text-white font-semibold text-sm transition-all"
        >
          <Maximize2 className="w-4 h-4" />
          Entrar no Modo Operação
        </button>
        <div className="flex gap-2">
          <button
            onClick={handleDismiss}
            className="flex-1 px-3 py-2 rounded-xl border border-border/80
                       text-xs text-muted-foreground hover:bg-secondary transition-colors"
          >
            Agora não
          </button>
          <button
            onClick={handleDismissForever}
            className="flex-1 px-3 py-2 rounded-xl border border-border/80
                       text-xs text-muted-foreground hover:bg-secondary transition-colors"
          >
            Não mostrar mais
          </button>
        </div>
      </div>
    </div>
  );
}
