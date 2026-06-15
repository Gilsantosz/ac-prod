import { useState, useMemo, useRef, useEffect } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Gauge } from 'lucide-react';
import { useCells } from '@/hooks/useCells';
import PageHeader from '@/components/ui/PageHeader';
import DashboardFilters from '@/components/dashboard/DashboardFilters';
import OeeGauge from '@/components/oee/OeeGauge';
import OeeByCellChart from '@/components/oee/OeeByCellChart';
import OeeCellTable from '@/components/oee/OeeCellTable';
import OeeReportButton from '@/components/oee/OeeReportButton';
import { computeOEE, oeeByCell } from '@/lib/oeeMetrics';

export default function OEE() {
  // Dark mode detection
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains('dark'))
    );
    obs.observe(document.documentElement, { attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  const [filters, setFilters] = useState({
    date: format(new Date(), 'yyyy-MM-dd'),
    shift: 'all',
    cell: 'all',
  });

  const { getCell } = useCells();
  const chartsRef = useRef(null);

  const { data: all = [] } = useQuery({
    queryKey: ['production'],
    queryFn: () => base44.entities.ProductionEntry.list('-date', 5000),
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
    <div
      className="p-4 sm:p-6 lg:p-8 space-y-5 sm:space-y-6"
      style={{
        minHeight: '100vh',
        background: dark
          ? 'linear-gradient(135deg, hsl(240 10% 3.9%) 0%, hsl(240 10% 5%) 55%, hsl(160 30% 5%) 100%)'
          : 'linear-gradient(135deg, #ffffff 0%, #f0fdf4 55%, #dcfce7 100%)',
        transition: 'background 0.4s ease',
      }}
    >
      <PageHeader
        title="OEE — Eficiência Global"
        subtitle="Disponibilidade × Performance × Qualidade por célula."
        icon={Gauge}
        actions={
          <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
            <DashboardFilters filters={filters} setFilters={setFilters} cells={cells} />
            <div className="w-full sm:w-auto shrink-0 flex">
              <OeeReportButton overall={overall} byCell={byCell} occurrences={filteredOccurrences} meta={reportMeta} chartsRef={chartsRef} disabled={filtered.length === 0} />
            </div>
          </div>
        }
      />

      {filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground border border-dashed border-border rounded-2xl">
          Nenhum dado para os filtros selecionados.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
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