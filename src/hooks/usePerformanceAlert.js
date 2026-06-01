import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

// Toca um beep curto via Web Audio (sem arquivos externos)
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // áudio bloqueado pelo navegador — ignora
  }
}

// Notifica (som + toast) quando NOVAS células atingem o alto desempenho
export function usePerformanceAlert(performers) {
  const seen = useRef(new Set());

  useEffect(() => {
    const novos = performers.filter((p) => !seen.current.has(p.key));
    if (novos.length > 0) {
      // evita disparar no primeiro carregamento da página
      if (seen.current.size > 0 || performers.length > novos.length) {
        beep();
      }
      novos.forEach((p) => {
        toast.success(`🏆 ${p.key} atingiu ${p.efficiency}% da meta!`, {
          description: 'Desempenho acima da média.',
        });
      });
    }
    seen.current = new Set(performers.map((p) => p.key));
  }, [performers]);
}