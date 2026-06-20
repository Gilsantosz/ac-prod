import { useEffect, useState } from 'react';
import { FileBarChart, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { IndustrialSectionCard } from '@/components/industrial';
import { REPORT_TYPES } from '@/lib/ai/aiReportService';

function sevenDaysAgo() {
  const date = new Date();
  date.setDate(date.getDate() - 6);
  return date.toISOString().slice(0, 10);
}

export default function AiReportRequestForm({ metadata, loading, onGenerate }) {
  const [reportType, setReportType] = useState('production_summary');
  const [format, setFormat] = useState('pdf');
  const [title, setTitle] = useState('');
  const [filters, setFilters] = useState({
    startDate: sevenDaysAgo(),
    endDate: new Date().toISOString().slice(0, 10),
    cells: [],
    lotsText: '',
    shifts: [],
    operator: '',
    order: '',
    loadNumber: '',
    product: '',
    client: '',
    customerLegalName: '',
    route: '',
    finalizationDate: '',
    palletNumber: '',
    stage: '',
    status: '',
    approvalStatus: '',
    onlyWithScrap: false,
    onlyWithDowntime: false,
    onlyWithOccurrence: false,
  });
  const [options, setOptions] = useState({ includeCharts: true, includeRecommendations: true, includeOccurrences: true, includeLots: true });

  useEffect(() => {
    const label = REPORT_TYPES.find((item) => item.value === reportType)?.label;
    if (!title || REPORT_TYPES.some((item) => item.label === title)) setTitle(label || 'Relatório Industrial');
  }, [reportType]);

  const toggleArray = (key, value) => {
    setFilters((current) => ({
      ...current,
      [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value],
    }));
  };

  const submit = (event) => {
    event.preventDefault();
    onGenerate({
      reportType,
      format,
      title,
      filters: { ...filters, lots: filters.lotsText.split(',').map((item) => item.trim()).filter(Boolean) },
      options,
    });
  };

  return (
    <IndustrialSectionCard title="Solicitar relatório" subtitle="Defina o escopo; o Copilot usa somente os registros encontrados." icon={FileBarChart}>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="space-y-2"><Label>Tipo</Label><Select value={reportType} onValueChange={setReportType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{REPORT_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Formato</Label><Select value={format} onValueChange={setFormat}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pdf">PDF</SelectItem><SelectItem value="xlsx">Excel</SelectItem><SelectItem value="csv">CSV</SelectItem><SelectItem value="html">HTML</SelectItem></SelectContent></Select></div>
          <div className="space-y-2 xl:col-span-2"><Label>Título</Label><Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required /></div>
          <div className="space-y-2"><Label>Data inicial</Label><Input type="date" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} required /></div>
          <div className="space-y-2"><Label>Data final</Label><Input type="date" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} required /></div>
          <div className="space-y-2"><Label>Operador</Label><Select value={filters.operator || 'all'} onValueChange={(value) => setFilters((current) => ({ ...current, operator: value === 'all' ? '' : value }))}><SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem>{metadata.operators.map((item) => <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Etapa</Label><Input value={filters.stage} onChange={(event) => setFilters((current) => ({ ...current, stage: event.target.value }))} placeholder="Corte, bordo, embalagem..." /></div>
          <div className="space-y-2"><Label>Lotes</Label><Input value={filters.lotsText} onChange={(event) => setFilters((current) => ({ ...current, lotsText: event.target.value }))} placeholder="LOTE-01, LOTE-02" /></div>
          <div className="space-y-2"><Label>Pedido</Label><Input value={filters.order} onChange={(event) => setFilters((current) => ({ ...current, order: event.target.value }))} /></div>
          <div className="space-y-2"><Label>Carga</Label><Input value={filters.loadNumber} onChange={(event) => setFilters((current) => ({ ...current, loadNumber: event.target.value }))} /></div>
          <div className="space-y-2"><Label>Produto</Label><Input value={filters.product} onChange={(event) => setFilters((current) => ({ ...current, product: event.target.value }))} /></div>
          <div className="space-y-2"><Label>Cliente</Label><Input value={filters.client} onChange={(event) => setFilters((current) => ({ ...current, client: event.target.value }))} /></div>
          <div className="space-y-2"><Label>Razão Social</Label><Input value={filters.customerLegalName} onChange={(event) => setFilters((current) => ({ ...current, customerLegalName: event.target.value }))} /></div>
          <div className="space-y-2"><Label>Roteiro</Label><Input value={filters.route} onChange={(event) => setFilters((current) => ({ ...current, route: event.target.value }))} /></div>
          <div className="space-y-2"><Label>Finalização</Label><Input type="date" value={filters.finalizationDate} onChange={(event) => setFilters((current) => ({ ...current, finalizationDate: event.target.value }))} /></div>
          <div className="space-y-2"><Label>Pallet</Label><Input value={filters.palletNumber} onChange={(event) => setFilters((current) => ({ ...current, palletNumber: event.target.value }))} /></div>
          <div className="space-y-2"><Label>Status do lote</Label><Select value={filters.status || 'all'} onValueChange={(value) => setFilters((current) => ({ ...current, status: value === 'all' ? '' : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="planned">Planejado</SelectItem><SelectItem value="in_progress">Em produção</SelectItem><SelectItem value="blocked">Bloqueado</SelectItem><SelectItem value="packed">Embalado</SelectItem><SelectItem value="shipped">Expedido</SelectItem></SelectContent></Select></div>
          <div className="space-y-2"><Label>Situação do apontamento</Label><Select value={filters.approvalStatus || 'all'} onValueChange={(value) => setFilters((current) => ({ ...current, approvalStatus: value === 'all' ? '' : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas</SelectItem><SelectItem value="valid">Válido</SelectItem><SelectItem value="pending_review">Em revisão</SelectItem><SelectItem value="corrected">Corrigido</SelectItem><SelectItem value="cancelled">Cancelado</SelectItem><SelectItem value="reversed">Estornado</SelectItem></SelectContent></Select></div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 border-t border-border pt-4">
          <fieldset className="space-y-2"><legend className="text-sm font-semibold mb-2">Células</legend><div className="flex flex-wrap gap-2">{metadata.cells.length ? metadata.cells.map((cell) => <label key={cell.id} className="inline-flex items-center gap-2 border border-border rounded-md px-3 py-2 text-sm cursor-pointer"><Checkbox checked={filters.cells.includes(cell.name)} onCheckedChange={() => toggleArray('cells', cell.name)} />{cell.name}</label>) : <span className="text-sm text-muted-foreground">Nenhuma célula cadastrada.</span>}</div></fieldset>
          <fieldset className="space-y-2"><legend className="text-sm font-semibold mb-2">Turnos</legend><div className="flex flex-wrap gap-2">{['1', '2', '3'].map((shift) => <label key={shift} className="inline-flex items-center gap-2 border border-border rounded-md px-3 py-2 text-sm cursor-pointer"><Checkbox checked={filters.shifts.includes(shift)} onCheckedChange={() => toggleArray('shifts', shift)} />Turno {shift}</label>)}</div></fieldset>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-3 border-t border-border pt-4">
          {[['onlyWithScrap', 'Somente com refugo'], ['onlyWithDowntime', 'Somente com parada'], ['onlyWithOccurrence', 'Somente com ocorrência']].map(([key, label]) => <label key={key} className="inline-flex items-center gap-2 text-sm"><Checkbox checked={filters[key]} onCheckedChange={(checked) => setFilters((current) => ({ ...current, [key]: !!checked }))} />{label}</label>)}
          {[['includeCharts', 'Incluir gráficos'], ['includeRecommendations', 'Incluir recomendações'], ['includeOccurrences', 'Incluir ocorrências'], ['includeLots', 'Incluir lotes']].map(([key, label]) => <label key={key} className="inline-flex items-center gap-2 text-sm"><Checkbox checked={options[key]} onCheckedChange={(checked) => setOptions((current) => ({ ...current, [key]: !!checked }))} />{label}</label>)}
        </div>

        <div className="flex justify-end"><Button type="submit" disabled={loading} className="gap-2">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}Analisar e gerar</Button></div>
      </form>
    </IndustrialSectionCard>
  );
}
