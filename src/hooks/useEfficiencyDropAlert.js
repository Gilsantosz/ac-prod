import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

// Beep grave de alerta via Web Audio (sem arquivos externos)
function alertBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 320;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    // áudio bloqueado pelo navegador — ignora
  }
}

// Notifica o supervisor (som + toast) quando um novo padrão de queda é detectado
export function useEfficiencyDropAlert(alert) {
  const lastSig = useRef(null);

  useEffect(() => {
    if (!alert) {
      lastSig.current = null;
      return;
    }
    const sig = `${alert.hours.join('-')}:${alert.drop}`;
    if (sig !== lastSig.current) {
      lastSig.current = sig;
      alertBeep();
      toast.warning(`⚠️ Queda de eficiência detectada (-${alert.drop}%)`, {
        description: alert.suggestions[0],
        duration: 8000,
      });
    }
  }, [alert]);
}