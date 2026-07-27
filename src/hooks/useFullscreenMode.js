/**
 * useFullscreenMode — Leo Flow
 * Hook centralizado para gerenciar o Modo Operação (Fullscreen API).
 *
 * Detecta:
 * - Se fullscreen está disponível no navegador
 * - Se fullscreen está ativo
 * - Se está rodando como PWA standalone, fullscreen, WCO ou aba comum
 * - Se está no Electron
 *
 * Expõe:
 * - isFullscreen: boolean
 * - isAvailable: boolean
 * - displayMode: 'browser' | 'standalone' | 'fullscreen' | 'window-controls-overlay' | 'electron'
 * - enterFullscreen(): Promise<void>
 * - exitFullscreen(): Promise<void>
 * - toggleFullscreen(): Promise<void>
 */

import { useState, useEffect, useCallback } from 'react';

/**
 * Detecta o modo de exibição atual da aplicação.
 * @returns {'electron'|'fullscreen'|'window-controls-overlay'|'standalone'|'browser'}
 */
export function detectDisplayMode() {
  if (typeof window === 'undefined') return 'browser';

  // Electron
  if (window.leoFlow || window.location.protocol === 'file:') return 'electron';

  // Fullscreen nativa (API do navegador)
  if (document.fullscreenElement) return 'fullscreen';

  // PWA Window Controls Overlay
  if (window.matchMedia('(display-mode: window-controls-overlay)').matches) {
    return 'window-controls-overlay';
  }

  // PWA Fullscreen (via manifest)
  if (window.matchMedia('(display-mode: fullscreen)').matches) return 'fullscreen';

  // PWA Standalone (iOS ou Android)
  if (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  ) {
    return 'standalone';
  }

  return 'browser';
}

/**
 * Verifica se a Fullscreen API está disponível no dispositivo.
 */
function isFullscreenApiAvailable() {
  return (
    typeof document !== 'undefined' &&
    (typeof document.fullscreenEnabled !== 'undefined'
      ? document.fullscreenEnabled
      : typeof document.webkitFullscreenEnabled !== 'undefined'
        ? document.webkitFullscreenEnabled
        : false)
  );
}

/**
 * Verifica se fullscreen está ativo no momento.
 */
function isFullscreenActive() {
  return (
    typeof document !== 'undefined' &&
    !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement
    )
  );
}

export function useFullscreenMode() {
  const [isAvailable] = useState(() => isFullscreenApiAvailable());
  const [isFullscreen, setIsFullscreen] = useState(() => isFullscreenActive());
  const [displayMode, setDisplayMode] = useState(() => detectDisplayMode());
  const [error, setError] = useState(null);

  // Atualiza estado quando fullscreen muda (incluindo saída por Esc)
  useEffect(() => {
    function handleChange() {
      const active = isFullscreenActive();
      setIsFullscreen(active);
      setDisplayMode(detectDisplayMode());
    }

    function handleError(e) {
      setError(e);
      setIsFullscreen(false);
    }

    document.addEventListener('fullscreenchange', handleChange);
    document.addEventListener('webkitfullscreenchange', handleChange);
    document.addEventListener('mozfullscreenchange', handleChange);
    document.addEventListener('fullscreenerror', handleError);
    document.addEventListener('webkitfullscreenerror', handleError);

    return () => {
      document.removeEventListener('fullscreenchange', handleChange);
      document.removeEventListener('webkitfullscreenchange', handleChange);
      document.removeEventListener('mozfullscreenchange', handleChange);
      document.removeEventListener('fullscreenerror', handleError);
      document.removeEventListener('webkitfullscreenerror', handleError);
    };
  }, []);

  /**
   * Entra no Modo Operação (fullscreen).
   * DEVE ser chamado por interação direta do usuário (click).
   */
  const enterFullscreen = useCallback(async () => {
    if (!isAvailable) {
      console.warn('[LeoFlow] Fullscreen API não disponível neste navegador.');
      return;
    }
    if (isFullscreenActive()) return;

    const el = document.documentElement;
    try {
      if (el.requestFullscreen) {
        await el.requestFullscreen({ navigationUI: 'hide' });
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      } else if (el.mozRequestFullScreen) {
        await el.mozRequestFullScreen();
      }
      setError(null);
    } catch (err) {
      // Fallback sem opções
      try {
        await (el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen).call(el);
      } catch (err2) {
        setError(err2);
        console.error('[LeoFlow] Falha ao ativar Modo Operação:', err2);
      }
    }
  }, [isAvailable]);

  /**
   * Sai do Modo Operação.
   */
  const exitFullscreen = useCallback(async () => {
    if (!isFullscreenActive()) return;
    try {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        await document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        await document.mozCancelFullScreen();
      }
    } catch (err) {
      console.error('[LeoFlow] Falha ao sair do Modo Operação:', err);
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (isFullscreen) {
      await exitFullscreen();
    } else {
      await enterFullscreen();
    }
  }, [isFullscreen, enterFullscreen, exitFullscreen]);

  return {
    isAvailable,
    isFullscreen,
    displayMode,
    error,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen,
  };
}
