import { useEffect, useState } from 'react';

export default function PwaUpdatePrompt() {
  const [registration, setRegistration] = useState(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || import.meta.env.DEV) return undefined;
    let active = true;
    const observe = (current) => {
      if (!active || !current) return;
      if (current.waiting && navigator.serviceWorker.controller) setRegistration(current);
      current.addEventListener('updatefound', () => {
        const worker = current.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) setRegistration(current);
        });
      });
    };
    navigator.serviceWorker.ready.then(observe).catch(() => {});
    return () => { active = false; };
  }, []);

  if (!registration) return null;
  return (
    <div className="fixed bottom-4 left-4 z-[110] max-w-sm rounded-2xl border border-emerald-400/30 bg-slate-950 p-4 text-slate-100 shadow-2xl">
      <p className="font-semibold">Nova versão disponível</p>
      <p className="mt-1 text-xs text-slate-400">As coletas pendentes continuam preservadas neste dispositivo.</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
          onClick={() => registration.waiting?.postMessage({ type: 'SKIP_WAITING' })}
        >
          Atualizar agora
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300"
          onClick={() => setRegistration(null)}
        >
          Depois
        </button>
      </div>
    </div>
  );
}
