import { useState, useMemo, useRef } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Gauge } from 'lucide-react';
import { useCells } from '@/hooks/useCells';
import DashboardFilters from '@/components/dashboard/DashboardFilters';
import OeeGauge from '@/components/oee/OeeGauge';
import OeeByCellChart from '@/components/oee/OeeByCellChart';
import OeeCellTable from '@/components/oee/OeeCellTable';
import OeeReportButton from '@/components/oee/OeeReportButton';
import { computeOEE, oeeByCell } from '@/lib/oeeMetrics';

export default function OEE() {
  const [filters, setFilters] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    shift: 'all',
    cell: 'all',
  });

  const { getCell } = useCells();
  const chartsRef = useRef(null);

  const { data: all = [] } = useQuery({
    queryKey: ['production'],
    queryFn: () => base44.entities.ProductionEntry.list('-created_date', 500),
    initialData: [],
  });

  const { data: allOccurrences = [] } = useQuery({
    queryKey: ['occurrences'],
    queryFn: () => base44.entities.Occurrence.list('-created_date', 500),
    initialData: [],
  });

  const cells = useMemo(() => [...new Set(all.map((e) => e.cell).filter(Boolean))], [all]);

  const filtered = useMemo(() => all.filter((e) => {
    if (filters.date && e.date !== filters.date) return false;
    if (filters.shift !== 'all' && e.shift !== filters.shift) return false;
    if (filters.cell !== 'all' && e.cell !== filters.cell) return false;
    return true;
  }), [all, filters]);

  const filteredOccurrences = useMemo(() => allOccurrences.filter((o) => {
    if (filters.date && o.date !== filters.date) return false;
    if (filters.shift !== 'all' && o.shift !== filters.shift) return false;
    if (filters.cell !== 'all' && o.cell !== filters.cell) return false;
    return true;
  }), [allOccurrences, filters]);

  const overall = useMemo(() => computeOEE(filtered, getCell), [filtered, getCell]);
  const byCell = useMemo(() => oeeByCell(filtered, getCell), [filtered, getCell]);

  const reportMeta = useMemo(() => ({
    title: 'Relatório de OEE — Turno',
    subtitle: `Data: ${filters.date}   Turno: ${filters.shift === 'all' ? 'Todos' : filters.shift}   Célula: ${filters.cell === 'all' ? 'Todas' : filters.cell}`,
  }), [filters]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 text-white p-6 lg:p-7 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center">
            <Gauge className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">OEE — Eficiência Global</h1>
            <p className="text-white/70 text-sm">Disponibilidade × Performance × Qualidade por célula.</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="[&_button]:bg-white/10 [&_button]:border-white/20 [&_button]:text-white">
            <DashboardFilters filters={filters} setFilters={setFilters} cells={cells} />
          </div>
          <OeeReportButton
            overall={overall}
            byCell={byCell}
            occurrences={filteredOccurrences}
            meta={reportMeta}
            chartsRef={chartsRef}
            disabled={filtered.length === 0}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground border border-dashed border-border rounded-2xl">
          Nenhum dado para os filtros selecionados.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <OeeGauge index={0} value={overall.oee} title="OEE Global" subtitle="Eficiência geral" />
            <OeeGauge index={1} value={overall.availability} title="Disponibilidade" subtitle={`${Math.round(overall.downtimeMin)} min parado`} />
            <OeeGauge index={2} value={overall.performance} title="Performance" subtitle={`${overall.produced.toLocaleString('pt-BR')} / ${overall.target.toLocaleString('pt-BR')}`} />
            <OeeGauge index={3} value={overall.quality} title="Qualidade" subtitle={`${overall.scrap} refugos`} />
          </div>

          <div ref={chartsRef} className="space-y-6 bg-background">
            <OeeByCellChart rows={byCell} />
            <OeeCellTable rows={byCell} />
          </div>
        </>
      )}
    </div>
  );
}