import { useState, useEffect } from 'react';
import { Minus, Square, Copy, X, Monitor, Info } from 'lucide-react';
import AboutModal from './AboutModal';

export default function CustomTitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [isKiosk, setIsKiosk] = useState(false);

  // Verificar se o app está rodando no Electron
  const isElectron = typeof window !== 'undefined' && (Boolean(window.leoFlow) || window.location.protocol === 'file:');

  useEffect(() => {
    if (!isElectron || !window.leoFlow) return;

    const checkMaximized = async () => {
      try {
        const max = await window.leoFlow.window.isMaximized();
        setIsMaximized(max);
      } catch (e) {
        // Fallback silencioso
      }
    };

    checkMaximized();
    window.addEventListener('resize', checkMaximized);
    return () => window.removeEventListener('resize', checkMaximized);
  }, [isElectron]);

  if (!isElectron) return null;

  const handleMinimize = () => window.leoFlow?.window?.minimize?.();
  const handleMaximize = async () => {
    const max = await window.leoFlow?.window?.maximize?.();
    setIsMaximized(max);
  };
  const handleClose = () => window.leoFlow?.window?.close?.();
  const handleToggleKiosk = async () => {
    const active = await window.leoFlow?.window?.toggleKiosk?.();
    setIsKiosk(active);
  };

  return (
    <>
      <header
        onDoubleClick={handleMaximize}
        className="h-9 bg-[#043820] text-emerald-100 flex items-center justify-between px-3 select-none border-b border-emerald-800/40 z-50 text-xs font-sans tracking-wide"
        style={{ WebkitAppRegion: 'drag' }}
      >
        {/* Lado Esquerdo: Logo & Nome oficial */}
        <div className="flex items-center gap-2.5" style={{ WebkitAppRegion: 'no-drag' }}>
          <img
            src="/brand/leo-madeiras-logo.jpg"
            alt="Leo Flow Logo"
            className="w-5 h-5 rounded-md object-contain border border-amber-400/40 shadow-sm"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <span className="font-extrabold text-white text-[12px] tracking-tight">
            Leo Flow
          </span>
          <span className="text-[11px] text-emerald-300/80 font-medium hidden sm:inline">
            — Controle de Produção
          </span>
        </div>

        {/* Lado Direito: Modo Operação, Sobre & Controles de Janela */}
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' }}>
          {/* Botão Modo Operação (Kiosk) */}
          <button
            type="button"
            onClick={handleToggleKiosk}
            title={isKiosk ? 'Sair do Modo Operação' : 'Ativar Modo Operação (Foco Fabril)'}
            className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 transition-all ${
              isKiosk
                ? 'bg-amber-500 text-black hover:bg-amber-400'
                : 'bg-emerald-900/80 hover:bg-emerald-800 text-emerald-200 border border-emerald-700/50'
            }`}
          >
            <Monitor className="w-3 h-3" />
            <span className="hidden md:inline">{isKiosk ? 'Modo Normal' : 'Modo Operação'}</span>
          </button>

          {/* Botão Sobre */}
          <button
            type="button"
            onClick={() => setShowAbout(true)}
            title="Sobre o Leo Flow"
            className="p-1 hover:bg-emerald-800/80 rounded text-emerald-300 hover:text-white transition-colors"
          >
            <Info className="w-3.5 h-3.5" />
          </button>

          <div className="h-3.5 w-px bg-emerald-800/60 mx-1" />

          {/* Botões Minimizar, Maximizar, Fechar */}
          <button
            type="button"
            onClick={handleMinimize}
            className="w-8 h-6 flex items-center justify-center hover:bg-emerald-800/80 rounded text-emerald-300 hover:text-white transition-colors"
            title="Minimizar"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleMaximize}
            className="w-8 h-6 flex items-center justify-center hover:bg-emerald-800/80 rounded text-emerald-300 hover:text-white transition-colors"
            title={isMaximized ? 'Restaurar' : 'Maximizar'}
          >
            {isMaximized ? <Copy className="w-3 h-3 rotate-180" /> : <Square className="w-3 h-3" />}
          </button>

          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-6 flex items-center justify-center hover:bg-rose-600 rounded text-emerald-300 hover:text-white transition-colors"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Modal Sobre */}
      <AboutModal open={showAbout} onOpenChange={setShowAbout} />
    </>
  );
}
