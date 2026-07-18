import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/ui/PageHeader';
import { useTraceability } from '@/hooks/useTraceability';
import LotKanban      from '@/components/traceability/LotKanban';
import LotSearch      from '@/components/traceability/LotSearch';
import LotTimeline    from '@/components/traceability/LotTimeline';

import {
  Layers, Search, GitBranch, RefreshCw, Clock, CheckCircle, Lock,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function Traceability() {
  const trace = useTraceability();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab = ['kanban', 'search', 'timeline'].includes(requestedTab) ? requestedTab : 'kanban';

  const handleTabChange = (value) => {
    setSearchParams(value === 'kanban' ? {} : { tab: value }, { replace: true });
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-5 sm:space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Rastreabilidade Geral"
          subtitle="Acompanhe cada lote e peça em tempo real — do Promob à expedição."
          icon={Layers}
        />
        <Button
          variant="outline"
          size="sm"
          className="gap-2 shrink-0"
          onClick={trace.refetch}
        >
          <RefreshCw className={cn('w-3.5 h-3.5', trace.lots.isFetching && 'animate-spin')} />
          Atualizar
        </Button>
      </div>

      {/* ── Stats Rápidos ───────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Layers}        label="Total Lotes"       value={trace.stats.total}       />
        <StatCard icon={Lock}          label="Bloqueados"         value={trace.stats.blocked}     accent="red" />
        <StatCard icon={Clock}         label="Em Atraso"          value={trace.stats.late}        accent="amber" />
        <StatCard icon={CheckCircle}   label="Finalizados"        value={trace.stats.completed}   accent="green" />
      </div>

      {/* ── Abas ───────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-5">
        <TabsList className="bg-card border border-border/60 h-auto p-1 flex-wrap gap-1">
          <TabsTrigger value="kanban" className="gap-2 text-xs sm:text-sm">
            <Layers className="w-3.5 h-3.5" /> Kanban
          </TabsTrigger>
          <TabsTrigger value="search" className="gap-2 text-xs sm:text-sm">
            <Search className="w-3.5 h-3.5" /> Buscar
          </TabsTrigger>
          <TabsTrigger value="timeline" className="gap-2 text-xs sm:text-sm">
            <GitBranch className="w-3.5 h-3.5" /> Histórico
          </TabsTrigger>
        </TabsList>

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

    </div>
  );
}

// ─── StatCard ─────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, accent, className }) {
  const colors = {
    red:    'text-red-600 bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800/40',
    amber:  'text-amber-600 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40',
    green:  'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40',
    default:'text-[#2d9c4a] bg-card border-border/60',
  };
  const c = colors[accent] || colors.default;
  return (
    <div className={cn('rounded-2xl p-4 border flex items-center gap-3', c, className)}>
      <Icon className={cn('w-5 h-5 shrink-0', accent ? '' : 'text-[#2d9c4a]')} />
      <div>
        <p className="text-xs text-muted-foreground leading-none">{label}</p>
        <p className="text-2xl font-bold mt-0.5">{value ?? 0}</p>
      </div>
    </div>
  );
}
