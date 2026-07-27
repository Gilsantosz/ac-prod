/**
 * FullscreenGate — Leo Flow
 *
 * Intercepta a abertura do PWA em modo standalone e exibe uma tela de entrada
 * mínima que, ao ser tocada/clicada, ativa o Modo Operação (fullscreen).
 *
 * Regras:
 * - Só aparece quando o app está rodando como PWA instalado (standalone / WCO)
 * - Não aparece quando o usuário escolheu "Não usar Modo Operação"
 * - Não aparece se já estiver em fullscreen
 * - Um único toque/clique em qualquer lugar ativa o fullscreen
 * - Após sair por Esc, mostra um banner sutil para reentrar
 */

import { useEffect, useState, useCallback } from 'react';
import { Maximize2 } from 'lucide-react';
import { detectDisplayMode } from '@/hooks/useFullscreenMode';

const PREF_KEY = 'lf_fullscreen_pref'; // 'auto' | 'off'

/** Verifica se o usuário optou por desativar o Modo Operação automático */
function getPreference() {
  try { return localStorage.getItem(PREF_KEY) || 'auto'; } catch { return 'auto'; }
}

function setPreference(val) {
  try { localStorage.setItem(PREF_KEY, val); } catch { /* noop */ }
}

function isFullscreenActive() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement
  );
}

async function requestFs() {
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else if (el.mozRequestFullScreen) await el.mozRequestFullScreen();
  } catch (e) {
    try { await (el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen).call(el); }
    catch { /* fallback falhou silenciosamente */ }
  }
}

/**
 * FullscreenGate
 * Renderiza um dos dois estados:
 * 1. Tela de entrada (antes do primeiro clique)
 * 2. Banner de re-entrada (após saída por Esc)
 */
export default function FullscreenGate() {
  const [showGate, setShowGate] = useState(false);
  const [showRejoin, setShowRejoin] = useState(false);

  const isPwa = () => {
    const m = detectDisplayMode();
    return m === 'standalone' || m === 'window-controls-overlay';
  };

  // Inicialização: decide se exibe o gate
  useEffect(() => {
    if (!isPwa()) return;                    // não é PWA, não faz nada
    if (getPreference() === 'off') return;   // usuário desativou
    if (isFullscreenActive()) return;        // já está em fullscreen

    // Pequeno delay para não competir com o carregamento inicial
    const t = setTimeout(() => setShowGate(true), 600);
    return () => clearTimeout(t);
  }, []);

  // Detecta saída de fullscreen (Esc ou outro motivo)
  useEffect(() => {
    function handleChange() {
      if (!isFullscreenActive()) {
        if (getPreference() !== 'off' && isPwa()) {
          setShowRejoin(true);
        }
        setShowGate(false);
      } else {
        setShowGate(false);
        setShowRejoin(false);
      }
    }

    document.addEventListener('fullscreenchange', handleChange);
    document.addEventListener('webkitfullscreenchange', handleChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleChange);
      document.removeEventListener('webkitfullscreenchange', handleChange);
    };
  }, []);

  // Handler: toque no gate → entra em fullscreen
  const handleGateClick = useCallback(async () => {
    await requestFs();
    setShowGate(false);
  }, []);

  // Handler: re-entrada após Esc
  const handleRejoin = useCallback(async () => {
    await requestFs();
    setShowRejoin(false);
  }, []);

  // Handler: desativar Modo Operação permanentemente
  const handleDisable = useCallback((e) => {
    e.stopPropagation();
    setPreference('off');
    setShowGate(false);
    setShowRejoin(false);
  }, []);

  // ── Tela de Entrada ────────────────────────────────────────────────────────
  if (showGate) {
    return (
      <div
        onClick={handleGateClick}
        role="button"
        aria-label="Entrar no Modo Operação"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleGateClick()}
        className="fixed inset-0 z-[9999] flex flex-col items-center justify-center
                   bg-[#004a24] cursor-pointer select-none"
        style={{ WebkitTapHighlightColor: 'transparent' }}
      >
        {/* Logo / branding */}
        <div className="flex flex-col items-center gap-6 pointer-events-none">
          <div className="w-20 h-20 rounded-3xl bg-white/10 border border-white/20
                          flex items-center justify-center shadow-2xl">
            <Maximize2 className="w-10 h-10 text-white" />
          </div>
          <div className="text-center">
            <p className="text-white font-bold text-2xl tracking-tight">Leo Flow</p>
            <p className="text-white/60 text-sm mt-1">Controle de Produção</p>
          </div>
          <div className="mt-4 flex flex-col items-center gap-2">
            <div className="w-12 h-12 rounded-full bg-white/10 border border-white/30
                            flex items-center justify-center animate-pulse">
              <span className="text-2xl">👆</span>
            </div>
            <p className="text-white/80 text-sm font-medium">Toque para iniciar</p>
          </div>
        </div>

        {/* Opção de não usar Modo Operação */}
        <button
          onClick={handleDisable}
          className="absolute bottom-8 text-xs text-white/30 hover:text-white/60
                     transition-colors underline underline-offset-2 pointer-events-auto"
        >
          Usar sem Modo Operação
        </button>
      </div>
    );
  }

  // ── Banner de Re-entrada (após Esc) ───────────────────────────────────────
  if (showRejoin) {
    return (
      <div className="fixed top-0 inset-x-0 z-[9998] flex items-center justify-between
                      gap-3 px-4 py-2.5 bg-[#004a24] text-white shadow-lg
                      animate-in slide-in-from-top-2 duration-300">
        <div className="flex items-center gap-2.5">
          <Maximize2 className="w-4 h-4 shrink-0 opacity-80" />
          <span className="text-sm font-medium">Modo Operação desativado</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRejoin}
            className="px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30
                       text-white text-xs font-bold transition-colors active:scale-95"
          >
            Reativar
          </button>
          <button
            onClick={handleDisable}
            className="px-3 py-1.5 rounded-lg hover:bg-white/10
                       text-white/50 text-xs transition-colors"
          >
            Não usar
          </button>
        </div>
      </div>
    );
  }

  return null;
}
