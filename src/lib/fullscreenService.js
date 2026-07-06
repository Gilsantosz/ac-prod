/**
 * Serviço utilitário para gerenciamento do modo Tela Cheia (Fullscreen API).
 */

export const isFullscreenSupported = () => {
  if (typeof document === 'undefined') return false;
  return !!(
    document.documentElement.requestFullscreen ||
    document.documentElement.webkitRequestFullscreen ||
    document.documentElement.msRequestFullscreen
  );
};

export const isFullscreenActive = () => {
  if (typeof document === 'undefined') return false;
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement
  );
};

export const enterFullscreen = async () => {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;

  try {
    if (el.requestFullscreen) return await el.requestFullscreen();
    if (el.webkitRequestFullscreen) return await el.webkitRequestFullscreen();
    if (el.msRequestFullscreen) return await el.msRequestFullscreen();
  } catch (err) {
    console.error('Falha ao solicitar tela cheia:', err);
    throw err;
  }

  throw new Error('Fullscreen não suportado neste navegador.');
};

export const exitFullscreen = async () => {
  if (typeof document === 'undefined') return;
  
  try {
    if (document.exitFullscreen) return await document.exitFullscreen();
    if (document.webkitExitFullscreen) return await document.webkitExitFullscreen();
    if (document.msExitFullscreen) return await document.msExitFullscreen();
  } catch (err) {
    console.error('Falha ao sair da tela cheia:', err);
    throw err;
  }
};

export const getDisplayMode = () => {
  if (typeof window === 'undefined') return 'browser';
  if (window.matchMedia('(display-mode: fullscreen)').matches) return 'fullscreen';
  if (window.matchMedia('(display-mode: standalone)').matches) return 'standalone';
  if (window.navigator.standalone) return 'standalone-ios';
  return 'browser';
};
