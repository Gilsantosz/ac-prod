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
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle, Clock, Play, CheckCircle2,
  Wrench, PauseCircle, Settings2, UserCheck,
  Zap, Utensils, PackageX, Disc, AlertCircle, Check
} from 'lucide-react';
import { getDowntimeReasons, startDowntime, registerPastDowntime, DEFAULT_DOWNTIME_REASONS } from '@/lib/downtimeService';
import { toast } from 'sonner';

export function getReasonMeta(reason) {
  if (!reason) {
    return {
      icon: AlertCircle,
      cleanName: 'Parada Operacional',
      categoryLabel: 'Geral',
      bgClass: 'border-border/60 bg-card hover:border-amber-400/50 hover:bg-amber-500/5',
      selectedClass: 'border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/30 text-amber-950 dark:text-amber-100',
      iconClass: 'text-amber-600 dark:text-amber-400 bg-amber-500/15',
      badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300',
    };
  }

  const code = String(reason.code || '').toUpperCase();
  const name = String(reason.name || '').toLowerCase();
  const category = String(reason.category || '').toLowerCase();

  if (code.includes('MANUT-FERRAMENTA') || name.includes('troca de ferramenta') || name.includes('lâmina')) {
    return {
      icon: Disc,
      cleanName: 'Troca de Ferramenta / Lâmina',
      categoryLabel: 'Ferramental',
      bgClass: 'border-border/60 bg-card hover:border-cyan-400/50 hover:bg-cyan-500/5',
      selectedClass: 'border-cyan-500 bg-cyan-500/10 ring-2 ring-cyan-500/30 text-cyan-950 dark:text-cyan-100',
      iconClass: 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/15',
      badgeClass: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/60 dark:text-cyan-300',
    };
  }

  if (code.includes('MANUT') || name.includes('manutenção') || category.includes('manutenção')) {
    return {
      icon: Wrench,
      cleanName: 'Máquinas em Manutenção',
      categoryLabel: 'Manutenção',
      bgClass: 'border-border/60 bg-card hover:border-rose-400/50 hover:bg-rose-500/5',
      selectedClass: 'border-rose-500 bg-rose-500/10 ring-2 ring-rose-500/30 text-rose-950 dark:text-rose-100',
      iconClass: 'text-rose-600 dark:text-rose-400 bg-rose-500/15',
      badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-300',
    };
  }

  if (code.includes('SEM-DEF') || name.includes('sem defeito')) {
    return {
      icon: PauseCircle,
      cleanName: 'Máquina Parada sem Defeito Prévio',
      categoryLabel: 'Operacional',
      bgClass: 'border-border/60 bg-card hover:border-slate-400/50 hover:bg-slate-500/5',
      selectedClass: 'border-slate-500 bg-slate-500/10 ring-2 ring-slate-500/30 text-slate-950 dark:text-slate-100',
      iconClass: 'text-slate-600 dark:text-slate-400 bg-slate-500/15',
      badgeClass: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300',
    };
  }

  if (code.includes('SET') || name.includes('setup') || category.includes('setup')) {
    return {
      icon: Settings2,
      cleanName: 'Ajuste de Setup',
      categoryLabel: 'Setup',
      bgClass: 'border-border/60 bg-card hover:border-purple-400/50 hover:bg-purple-500/5',
      selectedClass: 'border-purple-500 bg-purple-500/10 ring-2 ring-purple-500/30 text-purple-950 dark:text-purple-100',
      iconClass: 'text-purple-600 dark:text-purple-400 bg-purple-500/15',
      badgeClass: 'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-300',
    };
  }

  if (code.includes('BANHEIRO') || name.includes('banheiro') || category.includes('pessoal')) {
    return {
      icon: UserCheck,
      cleanName: 'Ida ao Banheiro',
      categoryLabel: 'Pessoal',
      bgClass: 'border-border/60 bg-card hover:border-emerald-400/50 hover:bg-emerald-500/5',
      selectedClass: 'border-emerald-500 bg-emerald-500/10 ring-2 ring-emerald-500/30 text-emerald-950 dark:text-emerald-100',
      iconClass: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/15',
      badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300',
    };
  }

  if (code.includes('ENERGIA') || name.includes('energia') || category.includes('utilidades')) {
    return {
      icon: Zap,
      cleanName: 'Queda de Energia',
      categoryLabel: 'Utilidades',
      bgClass: 'border-border/60 bg-card hover:border-amber-400/50 hover:bg-amber-500/5',
      selectedClass: 'border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/30 text-amber-950 dark:text-amber-100',
      iconClass: 'text-amber-600 dark:text-amber-400 bg-amber-500/15',
      badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300',
    };
  }

  if (code.includes('JANTA') || name.includes('janta') || name.includes('refeição') || category.includes('intervalo')) {
    return {
      icon: Utensils,
      cleanName: 'Parada para Janta / Refeição',
      categoryLabel: 'Intervalo',
      bgClass: 'border-border/60 bg-card hover:border-orange-400/50 hover:bg-orange-500/5',
      selectedClass: 'border-orange-500 bg-orange-500/10 ring-2 ring-orange-500/30 text-orange-950 dark:text-orange-100',
      iconClass: 'text-orange-600 dark:text-orange-400 bg-orange-500/15',
      badgeClass: 'bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-300',
    };
  }

  if (code.includes('FALTA') || name.includes('matéria-prima') || name.includes('material') || category.includes('abastecimento')) {
    return {
      icon: PackageX,
      cleanName: 'Falta de Matéria-Prima / Material',
      categoryLabel: 'Abastecimento',
      bgClass: 'border-border/60 bg-card hover:border-rose-400/50 hover:bg-rose-500/5',
      selectedClass: 'border-rose-500 bg-rose-500/10 ring-2 ring-rose-500/30 text-rose-950 dark:text-rose-100',
      iconClass: 'text-rose-600 dark:text-rose-400 bg-rose-500/15',
      badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-300',
    };
  }

  return {
    icon: AlertCircle,
    cleanName: reason.name || 'Parada Operacional',
    categoryLabel: reason.category || 'Geral',
    bgClass: 'border-border/60 bg-card hover:border-blue-400/50 hover:bg-blue-500/5',
    selectedClass: 'border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/30 text-blue-950 dark:text-blue-100',
    iconClass: 'text-blue-600 dark:text-blue-400 bg-blue-500/15',
    badgeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300',
  };
}

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
      const reasonMeta = selectedReason ? getReasonMeta(selectedReason) : null;
      const reasonName = reasonMeta ? reasonMeta.cleanName : (selectedReason?.name || customReason || 'Parada Operacional');

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
      const reasonMeta = selectedReason ? getReasonMeta(selectedReason) : null;
      const reasonName = reasonMeta ? reasonMeta.cleanName : (selectedReason?.name || customReason || 'Parada Registrada');

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] max-h-[90vh] overflow-y-auto rounded-2xl p-6 bg-card border border-border/80 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-extrabold text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            Registrar Parada na Coleta
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Selecione o motivo da interrupção com base na operação real da máquina ou célula.
          </DialogDescription>
        </DialogHeader>

        {/* Abas de Modo */}
        <div className="flex gap-2 p-1 bg-secondary/50 rounded-xl border border-border/40 my-2 text-xs font-semibold">
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

        <div className="space-y-4 py-1">
          {/* Info do Posto */}
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 text-xs space-y-1">
            <p className="text-amber-800 dark:text-amber-300 font-bold flex items-center gap-2">
              <span>Célula: {cellName}</span>
              {machineId && <span>• Máquina ID: {machineId}</span>}
            </p>
            <p className="text-muted-foreground">Operador: <strong className="text-foreground">{operatorName}</strong> (Turno {shift})</p>
          </div>

          {/* Seleção do Motivo Interativa com Ícones */}
          <div className="space-y-2">
            <Label className="text-xs font-bold text-muted-foreground flex items-center justify-between">
              <span>Selecione o Motivo da Parada *</span>
              <span className="text-[10px] text-muted-foreground font-normal">Clique no card para selecionar</span>
            </Label>

            {/* Grid Interativo de Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[300px] overflow-y-auto p-1 border border-border/40 rounded-xl bg-slate-50/50 dark:bg-slate-900/30">
              {reasons.map((r) => {
                const meta = getReasonMeta(r);
                const ReasonIcon = meta.icon;
                const isSelected = selectedReasonId === r.id;

                return (
                  <div
                    key={r.id}
                    onClick={() => setSelectedReasonId(r.id)}
                    className={`relative p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-3 select-none ${
                      isSelected ? meta.selectedClass : meta.bgClass
                    }`}
                  >
                    <div className={`p-2.5 rounded-xl shrink-0 ${meta.iconClass}`}>
                      <ReasonIcon className="w-5 h-5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${meta.badgeClass}`}>
                          {meta.categoryLabel}
                        </span>
                        {r.code && (
                          <span className="text-[9px] font-mono text-muted-foreground">
                            [{r.code}]
                          </span>
                        )}
                      </div>
                      <h4 className="text-xs font-bold text-foreground leading-snug truncate">
                        {meta.cleanName}
                      </h4>
                    </div>

                    {isSelected && (
                      <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-amber-500 text-white flex items-center justify-center shadow">
                        <Check className="w-3 h-3 stroke-[3]" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
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
              placeholder="Descreva a causa raiz ou ações tomadas..."
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
              disabled={loading || !selectedReasonId}
              className="text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl flex items-center gap-1.5 shadow-md"
            >
              <Play className="w-4 h-4" />
              {loading ? 'Iniciando...' : 'Iniciar Parada Agora'}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleRegisterPast}
              disabled={loading || !selectedReasonId}
              className="text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center gap-1.5 shadow-md"
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
