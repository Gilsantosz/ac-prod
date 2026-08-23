import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Download, FileText, FileSpreadsheet, FileImage, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { subDays } from 'date-fns';
import { exportCSV, exportPDF, exportPDFWithCharts } from '@/lib/exportProduction';
import { isAnnualFilterActive } from '@/lib/dashboardPeriod';
import { createProductionAnalysisReport } from '@/lib/reports/productionAnalysisReport';
import { useAuth } from '@/lib/AuthContext';

export default function ExportMenu({ entries, allEntries, filters, chartsRef }) {
  const { user } = useAuth();
  const [isExporting, setIsExporting] = useState(false);
  const exportLock = useRef(false);
  const annualMode = isAnnualFilterActive(filters.year);
  const shiftLabel = filters.shift === 'all' ? 'Todos os turnos' : filters.shift;
  const cellLabel = filters.cell === 'all' ? 'Todas as células' : filters.cell;
  const periodLabel = annualMode ? `Ano de ${filters.year}` : (filters.date || 'Todas as datas');
  const periodKey = annualMode ? filters.year : filters.date;
  const subtitle = `${periodLabel} · ${shiftLabel} · ${cellLabel}`;

  const run = async (fn, data, name, msg) => {
    if (!data.length) {
      toast.error('Nenhum dado para exportar');
      return;
    }
    if (exportLock.current) return;
    exportLock.current = true;
    setIsExporting(true);
    try {
      await fn(data, name);
      toast.success(msg);
    } catch {
      toast.error('Falha ao exportar relatório');
    } finally {
      exportLock.current = false;
      setIsExporting(false);
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

  const reportMeta = { title: annualMode ? 'Resumo Anual de Produção' : 'Relatório de Produção', subtitle };
  const analysisReport = useMemo(() => createProductionAnalysisReport({
    generatedAt: new Date().toISOString(),
    period: annualMode
      ? { from: `${filters.year}-01-01`, to: `${filters.year}-12-31` }
      : { from: filters.date, to: filters.date },
    comparisonPeriod: null,
    filters: { cell: filters.cell, shift: filters.shift },
    entries,
    comparisonEntries: [],
    fetchedRowCount: entries.length,
  }, { generatedBy: user?.name || user?.email || '' }), [annualMode, entries, filters.cell, filters.date, filters.shift, filters.year, user?.email, user?.name]);

  const runExcelReport = async () => {
    if (!entries.length) {
      toast.error('Nenhum dado para exportar');
      return;
    }
    if (exportLock.current) return;
    exportLock.current = true;
    setIsExporting(true);
    toast.loading('Gerando relatório Excel...', { id: 'dashboard-xlsx' });
    try {
      const { exportReport } = await import('@/lib/reports/reportEngine');
      await exportReport(analysisReport, 'xlsx');
      toast.success('Relatório Excel gerado.', { id: 'dashboard-xlsx' });
    } catch (error) {
      toast.error(error?.message || 'Falha ao gerar relatório Excel.', { id: 'dashboard-xlsx' });
    } finally {
      exportLock.current = false;
      setIsExporting(false);
    }
  };

  const runFullReport = async () => {
    if (!entries.length) {
      toast.error('Nenhum dado para exportar');
      return;
    }
    if (exportLock.current) return;
    exportLock.current = true;
    setIsExporting(true);
    toast.loading('Gerando relatório com gráficos...', { id: 'pdf' });
    try {
      await exportPDFWithCharts(
        entries,
        { ...reportMeta, title: annualMode ? 'Resumo Anual de Produção' : 'Relatório de Produção do Turno' },
        chartsRef?.current,
        `leo-flow-relatorio-producao-${periodKey}.pdf`,
      );
      toast.success('Relatório PDF gerado', { id: 'pdf' });
    } catch {
      toast.error('Falha ao gerar relatório', { id: 'pdf' });
    } finally {
      exportLock.current = false;
      setIsExporting(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" disabled={isExporting} className="gap-2 bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-full shadow-sm">
          {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Relatório completo</DropdownMenuLabel>
        <DropdownMenuItem onClick={runFullReport}>
          <FileImage className="w-4 h-4 mr-2" /> PDF com gráficos e métricas
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>{annualMode ? 'Resumo anual (filtros atuais)' : 'Fechamento diário (filtros atuais)'}</DropdownMenuLabel>
        <DropdownMenuItem onClick={runExcelReport}>
          <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel — Relatório editável
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run((d, n) => exportCSV(d, n, reportMeta), entries, `leo-flow-dados-producao-${periodKey}.csv`, 'CSV exportado')}>
          <FileSpreadsheet className="w-4 h-4 mr-2" /> CSV — Dados brutos
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run(
          (d, n) => exportPDF(d, { ...reportMeta, title: annualMode ? 'Resumo Anual' : 'Fechamento Diário' }, n),
          entries,
          `leo-flow-relatorio-producao-${periodKey}.pdf`,
          'PDF exportado',
        )}>
          <FileText className="w-4 h-4 mr-2" /> Exportar PDF
        </DropdownMenuItem>

        {!annualMode && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Fechamento semanal (7 dias)</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => run((d, n) => exportCSV(d, n, { title: 'Fechamento Semanal', subtitle: `Semana até ${filters.date}` }), weeklyData(), `leo-flow-dados-producao-semanal-${filters.date}.csv`, 'CSV semanal exportado')}>
              <FileSpreadsheet className="w-4 h-4 mr-2" /> Exportar CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run((d, n) => exportPDF(d, { title: 'Fechamento Semanal', subtitle: `Semana até ${filters.date}` }, n), weeklyData(), `leo-flow-relatorio-producao-semanal-${filters.date}.pdf`, 'PDF semanal exportado')}>
              <FileText className="w-4 h-4 mr-2" /> Exportar PDF
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
