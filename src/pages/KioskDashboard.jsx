import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Maximize2, Minimize2, RefreshCw, X, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Dashboard from '@/pages/Dashboard';
import {
  isFullscreenActive,
  isFullscreenSupported,
  enterFullscreen,
  exitFullscreen,
  getDisplayMode
} from '@/lib/fullscreenService';

export default function KioskDashboard() {
  const navigate = useNavigate();
  const [isFullscreen, setIsFullscreen] = useState(isFullscreenActive());
  const [displayMode, setDisplayMode] = useState(getDisplayMode());
  const [showBanner, setShowBanner] = useState(true);

  // Escutar eventos de alteração de tela cheia do navegador
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(isFullscreenActive());
      setDisplayMode(getDisplayMode());
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    // Checar inicialmente
    setIsFullscreen(isFullscreenActive());
    setDisplayMode(getDisplayMode());

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  const handleEnterFullscreen = async () => {
    try {
      await enterFullscreen();
      setIsFullscreen(true);
    } catch (error) {
      console.error('Falha ao entrar em tela cheia:', error);
    }
  };

  const handleExitKiosk = async () => {
    try {
      if (isFullscreenActive()) {
        await exitFullscreen();
      }
    } catch (error) {
      console.error('Erro ao sair do modo tela cheia:', error);
    }
    navigate('/');
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  // Determinar se precisamos mostrar o banner informativo
  // Mostra se o display mode for normal (browser) e não estiver em fullscreen, e o banner não tiver sido fechado
  const needsWarningBanner = showBanner && displayMode === 'browser' && !isFullscreen;

  return (
    <div className="relative w-screen h-screen flex flex-col bg-background text-foreground overflow-hidden select-none">
      {/* Banner Informativo Superior */}
      {needsWarningBanner && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-amber-500/10 border-b border-amber-500/20 text-amber-800 dark:text-amber-200 animate-slide-in text-sm shrink-0">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
            <span>
              Você está rodando no navegador comum. Para ocultar a barra de endereços, instale o <strong>Leo Flow</strong> como PWA ou ative a Tela Cheia.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleEnterFullscreen}
              className="h-8 border-amber-500/40 text-amber-900 dark:text-amber-100 bg-amber-500/20 hover:bg-amber-500/30 rounded-lg text-xs gap-1.5 font-semibold"
            >
              <Maximize2 className="w-3.5 h-3.5" /> Entrar em Tela Cheia
            </Button>
            <button
              onClick={() => setShowBanner(false)}
              className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-amber-500 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-200 active:scale-95 transition-all"
              title="Fechar aviso"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Floating Kiosk Controls (Discretos e flutuantes para não poluir o layout) */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2 opacity-20 hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300">
        {!isFullscreen && isFullscreenSupported() && (
          <Button
            size="sm"
            variant="secondary"
            onClick={handleEnterFullscreen}
            className="h-8 bg-card/85 border border-border hover:bg-secondary text-foreground rounded-lg text-xs gap-1.5 shadow-lg backdrop-blur"
            title="Entrar em Tela Cheia"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </Button>
        )}
        {isFullscreen && (
          <Button
            size="sm"
            variant="secondary"
            onClick={exitFullscreen}
            className="h-8 bg-card/85 border border-border hover:bg-secondary text-foreground rounded-lg text-xs gap-1.5 shadow-lg backdrop-blur"
            title="Sair de Tela Cheia"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={handleRefresh}
          className="h-8 bg-card/85 border border-border hover:bg-secondary text-foreground rounded-lg text-xs gap-1.5 shadow-lg backdrop-blur"
          title="Atualizar Dados"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Container Principal do Dashboard */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8">
        <Dashboard kioskModeOverride={true} />
      </div>
    </div>
  );
}
