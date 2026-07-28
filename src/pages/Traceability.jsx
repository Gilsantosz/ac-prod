import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/ui/PageHeader';
import { useTraceability } from '@/hooks/useTraceability';
import LotKanban      from '@/components/traceability/LotKanban';
import LotSearch      from '@/components/traceability/LotSearch';
import LotTimeline    from '@/components/traceability/LotTimeline';
import UpdateKpiModal from '@/components/traceability/UpdateKpiModal';

import {
  Layers, Search, GitBranch, RefreshCw, Clock, CheckCircle2, Lock,
  ChevronDown, TrendingUp
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function Traceability() {
  const trace = useTraceability();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isKpiModalOpen, setIsKpiModalOpen] = useState(false);
  const requestedTab = searchParams.get('tab');
  const activeTab = ['kanban', 'search', 'timeline'].includes(requestedTab) ? requestedTab : 'kanban';

  const handleTabChange = (value) => {
    setSearchParams(value === 'kanban' ? {} : { tab: value }, { replace: true });
  };

  const totalLots = trace.stats.total || 0;
  const blockedLots = trace.stats.blocked || 0;
  const lateLots = trace.stats.late || 0;
  const completedLots = trace.stats.completed || 0;

  const blockedPercent = totalLots > 0 ? Math.round((blockedLots / totalLots) * 100) : 0;
  const latePercent = totalLots > 0 ? Math.round((lateLots / totalLots) * 100) : 0;
  const completedPercent = totalLots > 0 ? Math.round((completedLots / totalLots) * 100) : 0;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      
      {/* ── Cabeçalho Principal ───────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap bg-card border border-border/60 rounded-3xl p-6 shadow-sm">
        <PageHeader
          title="Rastreabilidade Geral"
          subtitle="Acompanhe cada lote e peça em tempo real — do Promob à expedição."
          icon={Layers}
        />

        <div className="flex items-center gap-3 shrink-0 self-center">
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-secondary/40 px-3 py-2 rounded-xl border border-border/40">
            <span>Atualizado há 2 min</span>
            <button
              onClick={trace.refetch}
              className="hover:text-foreground transition-colors"
              title="Atualizar dados agora"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', trace.lots.isFetching && 'animate-spin')} />
            </button>
          </div>

          <Button
            onClick={() => setIsKpiModalOpen(true)}
            className="bg-[#00522d] hover:bg-[#004022] text-white gap-2 rounded-xl px-4 h-10 text-xs font-bold shadow-md transition-all"
          >
            <TrendingUp className="w-4 h-4" />
            Atualizar KPIs
            <ChevronDown className="w-3.5 h-3.5 opacity-80" />
          </Button>
        </div>
      </div>

      {/* ── StatCards Superiores ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Lotes */}
        <div className="bg-card border border-border/60 rounded-3xl p-5 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-[#2d9c4a] flex items-center justify-center shrink-0 border border-emerald-500/20">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Lotes</p>
              <p className="text-3xl font-extrabold text-foreground mt-0.5">{totalLots}</p>
              <p className="text-[11px] font-semibold text-muted-foreground mt-1">100% do total</p>
            </div>
          </div>
          {/* Sparkline gráfica decorativa */}
          <div className="w-16 h-10 opacity-70">
            <svg className="w-full h-full text-emerald-500" viewBox="0 0 100 40">
              <path
                d="M 5 35 Q 25 30 45 20 T 85 10 L 95 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>

        {/* Card 2: Bloqueados */}
        <div className="bg-card border border-border/60 rounded-3xl p-5 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0 border border-red-500/20">
              <Lock className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Bloqueados</p>
              <p className="text-3xl font-extrabold text-foreground mt-0.5">{blockedLots}</p>
              <p className="text-[11px] font-semibold text-muted-foreground mt-1">{blockedPercent}% do total</p>
            </div>
          </div>
        </div>

        {/* Card 3: Em Atraso */}
        <div className="bg-card border border-border/60 rounded-3xl p-5 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/20">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Em Atraso</p>
              <p className="text-3xl font-extrabold text-foreground mt-0.5">{lateLots}</p>
              <p className="text-[11px] font-semibold text-muted-foreground mt-1">{latePercent}% do total</p>
            </div>
          </div>
        </div>

        {/* Card 4: Finalizados */}
        <div className="bg-card border border-border/60 rounded-3xl p-5 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Finalizados</p>
              <p className="text-3xl font-extrabold text-foreground mt-0.5">{completedLots}</p>
              <p className="text-[11px] font-semibold text-muted-foreground mt-1">{completedPercent}% do total</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Abas de Navegação ────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <TabsList className="bg-secondary/40 border border-border/60 h-auto p-1 rounded-2xl flex-wrap gap-1">
            <TabsTrigger value="kanban" className="gap-2 text-xs sm:text-sm px-4 py-2 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <Layers className="w-4 h-4 text-emerald-600" /> Kanban
            </TabsTrigger>
            <TabsTrigger value="search" className="gap-2 text-xs sm:text-sm px-4 py-2 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <Search className="w-4 h-4 text-blue-500" /> Buscar
            </TabsTrigger>
            <TabsTrigger value="timeline" className="gap-2 text-xs sm:text-sm px-4 py-2 rounded-xl data-[state=active]:bg-background data-[state=active]:shadow-sm">
              <GitBranch className="w-4 h-4 text-purple-500" /> Histórico
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="kanban">
          <LotKanban trace={trace} />
        </TabsContent>

        <TabsContent value="search">
          <LotSearch />
        </TabsContent>

        <TabsContent value="timeline">
          <LotTimeline trace={trace} />
        </TabsContent>
      </Tabs>

      {/* ── Modal de Atualização de KPIs ────────────────────────────── */}
      <UpdateKpiModal
        open={isKpiModalOpen}
        onClose={() => setIsKpiModalOpen(false)}
      />

    </div>
  );
}

