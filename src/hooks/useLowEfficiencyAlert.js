import { useEffect, useRef, useState } from 'react';

// Beep grave de alerta via Web Audio (sem arquivos externos)
function alertBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 280;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.7);
  } catch {
    // áudio bloqueado pelo navegador — ignora
  }
}

function notifyBrowser(alert) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification('⚠️ Eficiência crítica', {
      body: `Célula ${alert.cell}: ${alert.currentEff}% há ${alert.consecutive}h seguidas (limite ${alert.threshold}%).`,
      tag: `low-eff-${alert.cell}`,
    });
  } catch {
    // ignora falhas de notificação
  }
}

// Monitora células com baixa eficiência sustentada e avisa via browser + modal.
export function useLowEfficiencyAlert(alerts) {
  const [active, setActive] = useState([]);
  const [dismissed, setDismissed] = useState(false);
  const lastSig = useRef('');

  // pede permissão de notificação uma vez
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const sig = alerts.map((a) => `${a.cell}:${a.consecutive}:${a.currentEff}`).sort().join('|');
    if (sig === lastSig.current) return;
    lastSig.current = sig;

    if (alerts.length > 0) {
      setActive(alerts);
      setDismissed(false);
      alertBeep();
      alerts.forEach(notifyBrowser);
    } else {
      setActive([]);
    }
  }, [alerts]);

  return {
    alerts: active,
    open: active.length > 0 && !dismissed,
    dismiss: () => setDismissed(true),
  };
}