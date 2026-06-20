import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, FileText, FileSpreadsheet, FileImage } from 'lucide-react';
import { toast } from 'sonner';
import { subDays } from 'date-fns';
import { exportCSV, exportPDF, exportPDFWithCharts } from '@/lib/exportProduction';

export default function ExportMenu({ entries, allEntries, filters, chartsRef }) {
  const shiftLabel = filters.shift === 'all' ? 'Todos os turnos' : filters.shift;
  const cellLabel = filters.cell === 'all' ? 'Todas as células' : filters.cell;
  const subtitle = `${filters.date || 'Todas as datas'} · ${shiftLabel} · ${cellLabel}`;

  const run = async (fn, data, name, msg) => {
    if (!data.length) {
      toast.error('Nenhum dado para exportar');
      return;
    }
    try {
      await fn(data, name);
      toast.success(msg);
    } catch {
      toast.error('Falha ao exportar relatório');
    }
  };

  // Fechamento semanal: últimos 7 dias a partir da data filtrada
  const weeklyData = () => {
    if (!filters.date) return entries;
    const end = new Date(filters.date);
    const start = subDays(end, 6);
    return allEntries.filter((e) => {
      const d = new Date(e.date);
      return d >= start && d <= end;
    });
  };

  const reportMeta = { title: 'Relatório de Produção', subtitle };

  const runFullReport = async () => {
    if (!entries.length) {
      toast.error('Nenhum dado para exportar');
      return;
    }
    toast.loading('Gerando relatório com gráficos...', { id: 'pdf' });
    try {
      await exportPDFWithCharts(entries, { ...reportMeta, title: 'Relatório de Produção do Turno' }, chartsRef?.current, `relatorio-${filters.date}.pdf`);
      toast.success('Relatório PDF gerado', { id: 'pdf' });
    } catch {
      toast.error('Falha ao gerar relatório', { id: 'pdf' });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2 bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-full shadow-sm">
          <Download className="w-4 h-4" /> Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Relatório completo</DropdownMenuLabel>
        <DropdownMenuItem onClick={runFullReport}>
          <FileImage className="w-4 h-4 mr-2" /> PDF com gráficos e métricas
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Fechamento diário (filtros atuais)</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => run((d, n) => exportCSV(d, n, reportMeta), entries, `producao-${filters.date}.csv`, 'CSV exportado')}>
          <FileSpreadsheet className="w-4 h-4 mr-2" /> Exportar CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run((d, n) => exportPDF(d, { ...reportMeta, title: 'Fechamento Diário' }, n), entries, `producao-${filters.date}.pdf`, 'PDF exportado')}>
          <FileText className="w-4 h-4 mr-2" /> Exportar PDF
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Fechamento semanal (7 dias)</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => run((d, n) => exportCSV(d, n, { title: 'Fechamento Semanal', subtitle: `Semana até ${filters.date}` }), weeklyData(), `semanal-${filters.date}.csv`, 'CSV semanal exportado')}>
          <FileSpreadsheet className="w-4 h-4 mr-2" /> Exportar CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run((d, n) => exportPDF(d, { title: 'Fechamento Semanal', subtitle: `Semana até ${filters.date}` }, n), weeklyData(), `semanal-${filters.date}.pdf`, 'PDF semanal exportado')}>
          <FileText className="w-4 h-4 mr-2" /> Exportar PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
