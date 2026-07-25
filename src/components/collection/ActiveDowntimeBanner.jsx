import { useState, useEffect } from 'react';
import { AlertTriangle, Clock, StopCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { finishDowntime } from '@/lib/downtimeService';
import { toast } from 'sonner';

export default function ActiveDowntimeBanner({
  activeDowntime = null,
  onDowntimeFinished = null
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeDowntime?.started_at && !activeDowntime?.created_at) return undefined;

    const start = new Date(activeDowntime.started_at || activeDowntime.created_at).getTime();

    const updateTimer = () => {
      const now = new Date().getTime();
      const diff = Math.max(0, Math.floor((now - start) / 1000));
      setElapsedSeconds(diff);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [activeDowntime]);

  if (!activeDowntime) return null;

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  const formattedTime = `${hours > 0 ? `${hours}h ` : ''}${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;

  const handleFinish = async () => {
    try {
      setLoading(true);
      const result = await finishDowntime(activeDowntime.id);
      toast.success(`Parada encerrada! Duração total: ${result.duration_minutes} min.`);
      onDowntimeFinished?.(result);
    } catch (error) {
      console.error('Erro ao encerrar parada:', error);
      toast.error(error.message || 'Falha ao encerrar parada.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 text-white rounded-2xl p-4 shadow-xl border border-amber-400/30 flex flex-col md:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-top duration-300">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center shrink-0 animate-pulse">
          <AlertTriangle className="w-6 h-6 text-amber-200" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded-full border border-white/30 text-amber-100">
              PARADA ATIVA NA CÉLULA
            </span>
            <span className="text-xs text-amber-100 font-medium">
              Motivo: <strong className="text-white">{activeDowntime.reason || 'Operacional'}</strong>
            </span>
          </div>
          <p className="text-xs text-amber-100 mt-1">
            Iniciada às {new Date(activeDowntime.started_at || activeDowntime.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} • Operador: <strong className="text-white">{activeDowntime.operator || 'N/A'}</strong>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
        {/* Cronômetro */}
        <div className="flex items-center gap-2 bg-black/30 backdrop-blur px-4 py-2 rounded-xl border border-white/20 font-mono text-sm font-extrabold text-amber-200">
          <Clock className="w-4 h-4 text-amber-300 animate-spin" style={{ animationDuration: '4s' }} />
          <span>{formattedTime}</span>
        </div>

        {/* Botão Encerrar */}
        <Button
          type="button"
          onClick={handleFinish}
          disabled={loading}
          className="bg-white text-rose-700 hover:bg-rose-50 font-extrabold text-xs h-10 rounded-xl shadow-lg border border-white/40 flex items-center gap-2 shrink-0"
        >
          <StopCircle className="w-4 h-4 text-rose-600" />
          {loading ? 'Encerrando...' : 'Encerrar Parada'}
        </Button>
      </div>
    </div>
  );
}
