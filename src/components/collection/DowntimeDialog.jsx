import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Clock, Play, CheckCircle2 } from 'lucide-react';
import { getDowntimeReasons, startDowntime, registerPastDowntime, DEFAULT_DOWNTIME_REASONS } from '@/lib/downtimeService';
import { toast } from 'sonner';

export default function DowntimeDialog({
  open = false,
  onOpenChange = null,
  cellId = null,
  cellName = 'Geral',
  machineId = null,
  operatorId = null,
  operatorName = 'Operador',
  shift = '1',
  onDowntimeStarted = null
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState('start_now'); // 'start_now' | 'past'
  const [reasons, setReasons] = useState([]);
  const [selectedReasonId, setSelectedReasonId] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [notes, setNotes] = useState('');
  const [startedAt, setStartedAt] = useState('');
  const [endedAt, setEndedAt] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      getDowntimeReasons({ activeOnly: true })
        .then((data) => {
          const list = data && data.length > 0 ? data : DEFAULT_DOWNTIME_REASONS;
          setReasons(list);
          if (list.length > 0) setSelectedReasonId(list[0].id);
        })
        .catch((err) => {
          console.error('Erro ao carregar motivos de parada:', err);
          setReasons(DEFAULT_DOWNTIME_REASONS);
          if (DEFAULT_DOWNTIME_REASONS.length > 0) setSelectedReasonId(DEFAULT_DOWNTIME_REASONS[0].id);
        });
    }
  }, [open]);

  const handleStartNow = async () => {
    try {
      setLoading(true);
      const selectedReason = reasons.find(r => r.id === selectedReasonId);
      const reasonName = selectedReason ? selectedReason.name : (customReason || 'Parada Operacional');

      const result = await startDowntime({
        downtimeReasonId: selectedReasonId || null,
        reason: reasonName,
        cellId,
        cellName,
        machineId,
        operatorId,
        operatorName,
        shift,
        notes: notes.trim()
      });

      queryClient.invalidateQueries({ queryKey: ['activeDowntime'] });
      queryClient.invalidateQueries({ queryKey: ['occurrences'] });
      queryClient.invalidateQueries({ queryKey: ['downtimeStats'] });
      queryClient.invalidateQueries({ queryKey: ['oeeStats'] });
      queryClient.invalidateQueries({ queryKey: ['cellKpis'] });

      toast.success('Parada iniciada com sucesso! Cronômetro ativo.');
      onDowntimeStarted?.(result);
      onOpenChange?.(false);
    } catch (error) {
      console.error('Erro ao iniciar parada:', error);
      toast.error(error.message || 'Falha ao iniciar parada.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterPast = async () => {
    if (!startedAt || !endedAt) {
      toast.error('Preencha os horários de início e fim da parada.');
      return;
    }

    try {
      setLoading(true);
      const selectedReason = reasons.find(r => r.id === selectedReasonId);
      const reasonName = selectedReason ? selectedReason.name : (customReason || 'Parada Registrada');

      const result = await registerPastDowntime({
        downtimeReasonId: selectedReasonId || null,
        reason: reasonName,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        cellId,
        cellName,
        machineId,
        operatorId,
        operatorName,
        shift,
        notes: notes.trim()
      });

      queryClient.invalidateQueries({ queryKey: ['activeDowntime'] });
      queryClient.invalidateQueries({ queryKey: ['occurrences'] });
      queryClient.invalidateQueries({ queryKey: ['downtimeStats'] });
      queryClient.invalidateQueries({ queryKey: ['oeeStats'] });
      queryClient.invalidateQueries({ queryKey: ['cellKpis'] });

      toast.success(`Parada passada registrada (${result.duration_minutes} min).`);
      onDowntimeStarted?.(result);
      onOpenChange?.(false);
    } catch (error) {
      console.error('Erro ao registrar parada passada:', error);
      toast.error(error.message || 'Falha ao registrar parada passada.');
    } finally {
      setLoading(false);
    }
  };
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px] rounded-2xl p-6 bg-card border border-border/80 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-extrabold text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            Registrar Parada na Coleta
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Registre uma interrupção na máquina ou célula de produção. O tempo será contabilizado no indicador de OEE.
          </DialogDescription>
        </DialogHeader>

        {/* Abas de Modo */}
        <div className="flex gap-2 p-1 bg-secondary/50 rounded-xl border border-border/40 my-3 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setMode('start_now')}
            className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
              mode === 'start_now' ? 'bg-background shadow text-amber-600 dark:text-amber-400 font-bold' : 'text-muted-foreground hover:bg-background/40'
            }`}
          >
            <Play className="w-3.5 h-3.5" />
            Iniciar Parada Agora
          </button>
          <button
            type="button"
            onClick={() => setMode('past')}
            className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
              mode === 'past' ? 'bg-background shadow text-indigo-600 dark:text-indigo-400 font-bold' : 'text-muted-foreground hover:bg-background/40'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Registrar Parada Passada
          </button>
        </div>

        <div className="space-y-4 py-2">
          {/* Info do Posto */}
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-xs space-y-1">
            <p className="text-amber-800 dark:text-amber-300 font-bold flex items-center gap-2">
              <span>Célula: {cellName}</span>
              {machineId && <span>• Máquina ID: {machineId}</span>}
            </p>
            <p className="text-muted-foreground">Operador: <strong className="text-foreground">{operatorName}</strong> (Turno {shift})</p>
          </div>

          {/* Seleção do Motivo vindo do banco */}
          <div className="space-y-1.5">
            <Label htmlFor="downtime-reason" className="text-xs font-bold text-muted-foreground">Motivo da Parada *</Label>
            <select
              id="downtime-reason"
              value={selectedReasonId}
              onChange={(e) => setSelectedReasonId(e.target.value)}
              className="w-full h-10 rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {reasons.map((r) => (
                <option key={r.id} value={r.id}>
                  [{r.code}] {r.name} ({r.category})
                </option>
              ))}
            </select>
          </div>

          {/* Horários para Parada Passada */}
          {mode === 'past' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="started-at" className="text-xs font-bold text-muted-foreground">Início da Parada *</Label>
                <Input
                  id="started-at"
                  type="datetime-local"
                  value={startedAt}
                  onChange={(e) => setStartedAt(e.target.value)}
                  className="h-10 text-xs rounded-xl"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ended-at" className="text-xs font-bold text-muted-foreground">Fim da Parada *</Label>
                <Input
                  id="ended-at"
                  type="datetime-local"
                  value={endedAt}
                  onChange={(e) => setEndedAt(e.target.value)}
                  className="h-10 text-xs rounded-xl"
                />
              </div>
            </div>
          )}

          {/* Observação */}
          <div className="space-y-1.5">
            <Label htmlFor="downtime-notes" className="text-xs font-bold text-muted-foreground">Observações / Detalhes (Opcional)</Label>
            <Textarea
              id="downtime-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Descreva causa raiz ou ação tomada..."
              rows={2}
              className="text-xs rounded-xl resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange?.(false)}
            disabled={loading}
            className="text-xs font-semibold rounded-xl"
          >
            Cancelar
          </Button>

          {mode === 'start_now' ? (
            <Button
              type="button"
              onClick={handleStartNow}
              disabled={loading}
              className="text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl flex items-center gap-1.5"
            >
              <Play className="w-4 h-4" />
              {loading ? 'Iniciando...' : 'Iniciar Parada Agora'}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleRegisterPast}
              disabled={loading}
              className="text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              {loading ? 'Salvando...' : 'Confirmar Parada Passada'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
