import { useEffect, useState } from 'react';

const LABELS = {
  connected: null,
  reconnecting: 'Realtime reconectando',
  degraded: 'Sincronização degradada',
  query_fallback: 'Sincronização por consulta',
  offline: 'Offline — coletas preservadas',
};

export default function RealtimeStatusIndicator() {
  const [status, setStatus] = useState(() => (
    typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'connected'
  ));

  useEffect(() => {
    const handleStatus = (event) => setStatus(event.detail?.status || 'degraded');
    const handleOnline = () => setStatus('reconnecting');
    const handleOffline = () => setStatus('offline');
    window.addEventListener('acprod-realtime-status', handleStatus);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('acprod-realtime-status', handleStatus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!LABELS[status]) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[100] rounded-full border border-amber-400/30 bg-slate-950/95 px-3 py-2 text-xs font-semibold text-amber-200 shadow-xl">
      {LABELS[status]}
    </div>
  );
}
