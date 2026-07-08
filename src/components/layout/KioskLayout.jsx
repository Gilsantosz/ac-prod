import { useEffect } from 'react';

/**
 * Layout especial para o Modo Quiosque.
 * Ocupa a tela cheia, remove barras administrativas, sidebar e margens do sistema normal.
 */
export default function KioskLayout({ children }) {
  useEffect(() => {
    // Adiciona classe de estilo específica no body ao montar
    document.body.classList.add('kiosk-mode');
    return () => {
      document.body.classList.remove('kiosk-mode');
    };
  }, []);

  return (
    <div className="min-h-screen w-screen overflow-hidden bg-background text-foreground transition-colors duration-200">
      {children}
    </div>
  );
}
