import { useState, useMemo } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { TimerOff, Clock, AlertTriangle, BarChart3 } from 'lucide-react';
import DashboardFilters from '@/components/dashboard/DashboardFilters';
import KpiCard from '@/components/dashboard/KpiCard';
import PageHeader from '@/components/ui/PageHeader';
import TopReasonsByCellChart from '@/components/downtime/TopReasonsByCellChart';
import DowntimeFrequencyChart from '@/components/downtime/DowntimeFrequencyChart';
import MttrChart from '@/components/downtime/MttrChart';
import { topReasonsByCell, frequencyOverTime, mttrByReason } from '@/lib/downtimeMetrics';

export default function DowntimeAnalysis() {
  const [filters, setFilters] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    shift: 'all',
    cell: 'all',
  });

  const { data: all = [] } = useQuery({
    queryKey: ['occurrences'],
    queryFn: () => base44.entities.Occurrence.list('-created_date', 1000),
    initialData: [],
  });

  const cells = useMemo(() => [...new Set(all.map((o) => o.cell).filter(Boolean))], [all]);

  const filtered = useMemo(() => all.filter((o) => {
    if (filters.date && o.date !== filters.date) return false;
    if (filters.shift !== 'all' && o.shift !== filters.shift) return false;
    if (filters.cell !== 'all' && o.cell !== filters.cell) return false;
    return true;
  }), [all, filters]);

  const topReasons = useMemo(() => topReasonsByCell(filtered), [filtered]);
  const frequency = useMemo(() => frequencyOverTime(filtered), [filtered]);
  const mttr = useMemo(() => mttrByReason(filtered), [filtered]);

  const totalDowntime = filtered.reduce((a, o) => a + (Number(o.downtime) || 0), 0);
  const avgMttr = mttr.length > 0 ? Math.round((mttr.reduce((a, m) => a + m.mttr, 0) / mttr.length) * 10) / 10 : 0;
  const topReason = mttr.length > 0 ? [...mttr].sort((a, b) => b.total - a.total)[0] : null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6">
      <PageHeader
        title="Análise de Paradas"
        subtitle="Top motivos por célula, frequência no tempo e MTTR por tipo."
        icon={TimerOff}
        actions={<DashboardFilters filters={filters} setFilters={setFilters} cells={cells} />}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Ocorrências" value={filtered.length} icon={AlertTriangle} />
        <KpiCard title="Tempo total parado" value={`${totalDowntime} min`} icon={TimerOff} />
        <KpiCard title="MTTR médio" value={`${avgMttr} min`} icon={Clock} />
        <KpiCard title="Maior ofensor" value={topReason ? topReason.reason : '—'} icon={BarChart3} />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground border border-dashed border-border rounded-2xl">
          Nenhuma ocorrência para os filtros selecionados.
        </div>
      ) : (
        <>
          <DowntimeFrequencyChart data={frequency} />
          <MttrChart data={mttr} />
          <TopReasonsByCellChart data={topReasons} />
        </>
      )}
    </div>
  );
}