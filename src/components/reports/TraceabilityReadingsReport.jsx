import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Filter, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabaseClient';
import { buildBrandedCsv, downloadBlob } from '@/lib/reportBranding';

const EMPTY = { search: '', tagType: 'all', cell: 'all', step: 'all', operator: '', status: 'all', date: '', shift: 'all', readerType: 'all' };

export default function TraceabilityReadingsReport() {
  const [filters, setFilters] = useState(EMPTY);
  const set = (key, value) => setFilters((current) => ({ ...current, [key]: value }));

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['traceability-report-readings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_stage_readings')
        .select(`
          *,
          production_lots (lot_code, order_number, product_code, product_name),
          production_lot_items (item_code, product_code, product_name),
          production_tags (tag_type, tag_format)
        `)
        .order('created_at', { ascending: false })
        .limit(3000);
      if (error) throw error;
      return data || [];
    },
    initialData: [],
    retry: false,
  });

  const options = useMemo(() => ({
    cells: [...new Set(rows.map((row) => row.cell_name).filter(Boolean))].sort(),
    steps: [...new Set(rows.map((row) => row.step_name).filter(Boolean))].sort(),
  }), [rows]);

  const filtered = useMemo(() => rows.filter((row) => {
    const text = [row.production_lots?.lot_code, row.production_lots?.order_number, row.production_lots?.product_code, row.production_lots?.product_name, row.production_lot_items?.item_code, row.production_lot_items?.product_name, row.tag_value].join(' ').toLowerCase();
    if (filters.search && !text.includes(filters.search.toLowerCase())) return false;
    if (filters.tagType !== 'all' && row.production_tags?.tag_type !== filters.tagType) return false;
    if (filters.cell !== 'all' && row.cell_name !== filters.cell) return false;
    if (filters.step !== 'all' && row.step_name !== filters.step) return false;
    if (filters.operator && !String(row.operator || '').toLowerCase().includes(filters.operator.toLowerCase())) return false;
    if (filters.status !== 'all' && row.status !== filters.status) return false;
    if (filters.date && row.date !== filters.date) return false;
    if (filters.shift !== 'all' && row.shift !== filters.shift) return false;
    if (filters.readerType !== 'all' && row.reader_type !== filters.readerType) return false;
    return true;
  }), [rows, filters]);

  const exportCsv = () => {
    const normalized = filtered.map((row) => ({
      date: row.date, hour: row.hour, lot: row.production_lots?.lot_code, order: row.production_lots?.order_number,
      product: row.production_lot_items?.product_name || row.production_lots?.product_name,
      piece: row.production_lot_items?.item_code, tag: row.tag_value, tagType: row.production_tags?.tag_type,
      cell: row.cell_name, step: row.step_name, operator: row.operator, status: row.status,
      shift: row.shift, reader: row.reader_type,
    }));
    const csv = buildBrandedCsv({
      title: 'Rastreabilidade por Leitura',
      subtitle: 'Filtros de lote, pedido, produto, peça, tag, célula, etapa, operador, status, data, turno e leitor',
      summary: [{ label: 'Leituras', value: normalized.length }],
      columns: [
        ['date','Data'],['hour','Hora'],['lot','Lote'],['order','Pedido/OP'],['product','Produto'],['piece','Peça'],
        ['tag','Tag'],['tagType','Tipo tag'],['cell','Célula'],['step','Etapa'],['operator','Operador'],
        ['status','Status'],['shift','Turno'],['reader','Leitor'],
      ].map(([key,label]) => ({ key, label })),
      rows: normalized,
    });
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `rastreabilidade-leituras-${new Date().toISOString().slice(0,10)}.csv`);
  };

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-md p-4 space-y-3">
        <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold flex items-center gap-2"><Filter className="w-4 h-4" /> Filtros de rastreabilidade</h3><p className="text-xs text-muted-foreground mt-1">{filtered.length} leitura(s) encontrada(s)</p></div><Button variant="outline" onClick={exportCsv} disabled={!filtered.length} className="gap-2"><Download /> Exportar CSV</Button></div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Input value={filters.search} onChange={(event) => set('search', event.target.value)} placeholder="Lote, pedido, produto, peça ou tag" />
          <Input value={filters.operator} onChange={(event) => set('operator', event.target.value)} placeholder="Operador" />
          <Input type="date" value={filters.date} onChange={(event) => set('date', event.target.value)} />
          <FilterSelect value={filters.tagType} onChange={(value) => set('tagType', value)} options={['barcode','qrcode','datamatrix','rfid_epc','rfid_tid','manual']} label="Todos os tipos de tag" />
          <FilterSelect value={filters.cell} onChange={(value) => set('cell', value)} options={options.cells} label="Todas as células" />
          <FilterSelect value={filters.step} onChange={(value) => set('step', value)} options={options.steps} label="Todas as etapas" />
          <FilterSelect value={filters.status} onChange={(value) => set('status', value)} options={['approved','rejected','blocked','duplicated','pending_review']} label="Todos os status" />
          <FilterSelect value={filters.shift} onChange={(value) => set('shift', value)} options={['1º Turno','2º Turno','3º Turno']} label="Todos os turnos" />
          <FilterSelect value={filters.readerType} onChange={(value) => set('readerType', value)} options={['keyboard_barcode','camera_qrcode','camera_barcode','manual','rfid_fixed','rfid_handheld','api']} label="Todos os leitores" />
        </div>
      </div>

      <div className="bg-card border border-border rounded-md overflow-hidden">
        <div className="overflow-x-auto max-h-[560px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-secondary z-10"><tr>{['Data/Hora','Lote / Pedido','Peça / Tag','Etapa / Célula','Operador','Status','Leitor'].map((label) => <th key={label} className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground whitespace-nowrap">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {isLoading && <tr><td colSpan="7" className="p-8 text-center text-muted-foreground">Carregando rastreabilidade...</td></tr>}
              {!isLoading && !filtered.length && <tr><td colSpan="7" className="p-8 text-center text-muted-foreground">Nenhuma leitura para os filtros.</td></tr>}
              {filtered.map((row) => (
                <tr key={row.id} className="hover:bg-secondary/40">
                  <td className="px-3 py-2 whitespace-nowrap">{row.date}<br/><span className="text-xs text-muted-foreground">{row.hour}</span></td>
                  <td className="px-3 py-2"><strong>{row.production_lots?.lot_code || '—'}</strong><br/><span className="text-xs text-muted-foreground">{row.production_lots?.order_number || '—'}</span></td>
                  <td className="px-3 py-2"><span>{row.production_lot_items?.item_code || '—'}</span><br/><span className="text-xs font-mono text-muted-foreground">{row.tag_value}</span></td>
                  <td className="px-3 py-2">{row.step_name || '—'}<br/><span className="text-xs text-muted-foreground">{row.cell_name || '—'}</span></td>
                  <td className="px-3 py-2 whitespace-nowrap">{row.operator || '—'}</td>
                  <td className="px-3 py-2"><span className="text-xs font-semibold">{row.status}</span></td>
                  <td className="px-3 py-2 whitespace-nowrap"><ScanLine className="inline w-3.5 h-3.5 mr-1" />{row.reader_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FilterSelect({ value, onChange, options, label }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="all">{label}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
}
