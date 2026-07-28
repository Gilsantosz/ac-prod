import { useState } from 'react';
import {
  X, TrendingUp, Target, BarChart2, Percent, Trash2, Check,
  Calendar, ShieldCheck, Gauge
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export default function UpdateKpiModal({ open, onClose, initialData = {}, onSave }) {
  const [activeTab, setActiveTab] = useState('production'); // 'production' | 'quality' | 'oee'

  // Estado dos formulários
  const [targetGoal, setTargetGoal] = useState(initialData.targetGoal ?? 200);
  const [produced, setProduced] = useState(initialData.produced ?? 126);
  const [scrap, setScrap] = useState(initialData.scrap ?? 4);
  const [efficiency, setEfficiency] = useState(initialData.efficiency ?? 63);
  const [period, setPeriod] = useState('today');
  const [observation, setObservation] = useState('');

  if (!open) return null;

  const handleSave = () => {
    const payload = {
      targetGoal: Number(targetGoal) || 0,
      produced: Number(produced) || 0,
      scrap: Number(scrap) || 0,
      efficiency: Number(efficiency) || 0,
      period,
      observation,
      updatedAt: new Date().toISOString(),
    };

    if (onSave) {
      onSave(payload);
    } else {
      try {
        localStorage.setItem('traceability_kpi_override', JSON.stringify(payload));
      } catch (e) {
        console.error('Erro ao salvar KPIs:', e);
      }
    }

    toast.success('Indicadores de produção atualizados com sucesso!');
    onClose();
  };

  // Cálculos dinâmicos para o Resumo ao Vivo
  const targetNum = Number(targetGoal) || 1;
  const prodNum = Number(produced) || 0;
  const goalPercent = Math.max(0, Math.min(100, Math.round((prodNum / targetNum) * 100)));
  const effNum = Number(efficiency) || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-card border border-border/80 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* ── Header ───────────────────────────────────────────── */}
        <div className="px-6 py-5 border-b border-border/60 flex items-start justify-between gap-4 bg-secondary/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-[#2d9c4a] flex items-center justify-center shrink-0 border border-emerald-500/20">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">Atualizar indicadores</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Informe os novos valores para manter os KPIs atualizados.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Sub-tabs ────────────────────────────────────────── */}
        <div className="px-6 pt-4">
          <div className="flex border border-border/60 rounded-2xl p-1 bg-secondary/30">
            <button
              onClick={() => setActiveTab('production')}
              className={cn(
                "flex-1 py-2 px-3 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2",
                activeTab === 'production'
                  ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <BarChart2 className="w-4 h-4 text-emerald-600" /> Produção
            </button>
            <button
              onClick={() => setActiveTab('quality')}
              className={cn(
                "flex-1 py-2 px-3 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2",
                activeTab === 'quality'
                  ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <ShieldCheck className="w-4 h-4 text-blue-600" /> Qualidade
            </button>
            <button
              onClick={() => setActiveTab('oee')}
              className={cn(
                "flex-1 py-2 px-3 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2",
                activeTab === 'oee'
                  ? "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Gauge className="w-4 h-4 text-purple-600" /> OEE
            </button>
          </div>
        </div>

        {/* ── Corpo do Modal ───────────────────────────────────── */}
        <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-12 gap-6">
          
          {/* Coluna Esquerda: Formulário */}
          <div className="md:col-span-7 space-y-4">
            
            {/* Meta do Dia */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-emerald-600" /> Meta do dia
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={targetGoal}
                  onChange={(e) => setTargetGoal(e.target.value)}
                  className="w-full h-10 px-3 pr-10 rounded-xl border border-border/80 bg-background text-sm font-semibold focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                  pc
                </span>
              </div>
            </div>

            {/* Produzido */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <BarChart2 className="w-3.5 h-3.5 text-blue-600" /> Produzido
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={produced}
                  onChange={(e) => setProduced(e.target.value)}
                  className="w-full h-10 px-3 pr-10 rounded-xl border border-border/80 bg-background text-sm font-semibold focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                  pc
                </span>
              </div>
            </div>

            {/* Refugo */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5 text-red-500" /> Refugo
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={scrap}
                  onChange={(e) => setScrap(e.target.value)}
                  className="w-full h-10 px-3 pr-10 rounded-xl border border-border/80 bg-background text-sm font-semibold focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                  pc
                </span>
              </div>
            </div>

            {/* % Eficiência */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Percent className="w-3.5 h-3.5 text-purple-600" /> % Eficiência
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={efficiency}
                  onChange={(e) => setEfficiency(e.target.value)}
                  className="w-full h-10 px-3 pr-10 rounded-xl border border-border/80 bg-background text-sm font-semibold focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                  %
                </span>
              </div>
            </div>

            {/* Período */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-amber-500" /> Período
              </label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-border/80 bg-background text-xs font-medium focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
              >
                <option value="today">Hoje ({new Date().toLocaleDateString('pt-BR')})</option>
                <option value="shift1">Turno 1 (06:00 - 14:00)</option>
                <option value="shift2">Turno 2 (14:00 - 22:00)</option>
                <option value="week">Esta Semana</option>
              </select>
            </div>

            {/* Observação */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Observação
              </label>
              <textarea
                value={observation}
                onChange={(e) => setObservation(e.target.value.slice(0, 200))}
                placeholder="Adicione uma observação (opcional)..."
                className="w-full h-20 px-3 py-2 text-xs rounded-xl border border-border/80 bg-background resize-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
              />
              <div className="text-right text-[10px] text-muted-foreground">
                {observation.length}/200
              </div>
            </div>

          </div>

          {/* Coluna Direita: Resumo Ao Vivo */}
          <div className="md:col-span-5 bg-emerald-500/5 dark:bg-emerald-950/20 border border-emerald-500/20 rounded-2xl p-4 flex flex-col justify-between space-y-4">
            <div>
              <h3 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3">
                Resumo ao vivo
              </h3>

              <div className="space-y-2.5">
                {/* Meta do dia card */}
                <div className="bg-card border border-border/60 rounded-xl p-3 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 flex items-center justify-center shrink-0">
                      <Target className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground leading-tight">Meta do dia</p>
                      <p className="text-sm font-bold text-foreground">{targetGoal} pc</p>
                    </div>
                  </div>
                </div>

                {/* Produzido card */}
                <div className="bg-card border border-border/60 rounded-xl p-3 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center shrink-0">
                      <BarChart2 className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground leading-tight">Produzido</p>
                      <p className="text-sm font-bold text-foreground">{produced} pc</p>
                    </div>
                  </div>
                </div>

                {/* Eficiência card com gauge circular */}
                <div className="bg-card border border-border/60 rounded-xl p-3 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-purple-100 dark:bg-purple-900/40 text-purple-600 flex items-center justify-center shrink-0">
                      <Percent className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-[11px] text-muted-foreground leading-tight">Eficiência</p>
                      <p className="text-sm font-bold text-foreground">{efficiency}%</p>
                    </div>
                  </div>
                  
                  {/* Gauge SVG Circular Mini */}
                  <div className="relative w-8 h-8 flex items-center justify-center shrink-0">
                    <svg className="w-8 h-8 transform -rotate-90" viewBox="0 0 36 36">
                      <path
                        className="text-secondary"
                        strokeWidth="4"
                        stroke="currentColor"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                      <path
                        className="text-emerald-500 transition-all duration-500 ease-out"
                        strokeDasharray={`${effNum}, 100`}
                        strokeWidth="4"
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="none"
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      />
                    </svg>
                  </div>
                </div>

                {/* Refugo card */}
                <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-xl p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/40 text-red-600 flex items-center justify-center shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-[11px] text-red-600/80 dark:text-red-400/80 leading-tight">Refugo</p>
                      <p className="text-sm font-bold text-red-700 dark:text-red-300">{scrap} pc</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Barra de Progresso da Meta */}
            <div className="space-y-1.5 border-t border-emerald-500/20 pt-3">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground font-semibold">
                <span>Progresso da meta</span>
                <span className="text-emerald-600 font-bold">{goalPercent}%</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-600 transition-all duration-300"
                  style={{ width: `${goalPercent}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground text-right mt-1">
                {produced} de {targetGoal} pc
              </p>
            </div>

          </div>

        </div>

        {/* ── Footer ───────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-border/60 bg-secondary/10 flex items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="rounded-xl px-5 h-10 text-xs font-semibold"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            className="rounded-xl px-6 h-10 text-xs font-semibold bg-[#00522d] hover:bg-[#004022] text-white gap-2 shadow-md"
          >
            <Check className="w-4 h-4" /> Salvar atualização
          </Button>
        </div>

      </div>
    </div>
  );
}
