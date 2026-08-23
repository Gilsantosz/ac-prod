import { useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, Loader2, Table2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { REPORT_FORMAT_OPTIONS } from '@/lib/reports/reportDefinition';

const FORMAT_ICONS = { pdf: FileText, xlsx: FileSpreadsheet, csv: Table2 };
const PROGRESS_LABELS = { pdf: 'Gerando relatório PDF...', xlsx: 'Gerando relatório Excel...', csv: 'Gerando dados CSV...' };
const SUCCESS_LABELS = { pdf: 'Relatório PDF gerado.', xlsx: 'Relatório Excel gerado.', csv: 'Dados CSV gerados.' };

export default function ExportReportMenu({
  report,
  getReport,
  formats = ['pdf', 'xlsx', 'csv'],
  disabled = false,
  className = '',
  formatExporters = {},
  onSuccess,
  onError,
}) {
  const [activeFormat, setActiveFormat] = useState(null);
  const exportLock = useRef(false);
  const availableFormats = formats.filter((format) => REPORT_FORMAT_OPTIONS[format]);

  const handleExport = async (format) => {
    if ((!report && !getReport) || exportLock.current) return;
    exportLock.current = true;
    setActiveFormat(format);
    const toastId = `report-export-${report?.id || 'async'}`;
    toast.loading(PROGRESS_LABELS[format], { id: toastId });
    try {
      const resolvedReport = getReport ? await getReport(format) : report;
      if (!resolvedReport) throw new Error('Não há dados disponíveis para este relatório.');
      let result;
      if (formatExporters[format]) {
        result = await formatExporters[format](resolvedReport);
      } else {
        const { exportReport } = await import('@/lib/reports/reportEngine');
        result = await exportReport(resolvedReport, format);
      }
      toast.success(SUCCESS_LABELS[format], { id: toastId });
      onSuccess?.({ format, result });
    } catch (error) {
      console.error('Falha controlada ao exportar relatório', { format, code: error?.code, message: error?.message });
      toast.error(error?.message || 'Não foi possível gerar o relatório.', { id: toastId });
      onError?.({ format, error });
    } finally {
      exportLock.current = false;
      setActiveFormat(null);
    }
  };

  const isLoading = Boolean(activeFormat);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled || (!report && !getReport) || isLoading || availableFormats.length === 0}
          className={`gap-2 bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-full shadow-sm ${className}`}
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Exportar
          <ChevronDown className="w-3.5 h-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Escolha a finalidade</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {availableFormats.map((format) => {
          const Icon = FORMAT_ICONS[format];
          const option = REPORT_FORMAT_OPTIONS[format];
          return (
            <DropdownMenuItem key={format} disabled={isLoading} onClick={() => handleExport(format)} className="gap-3 py-2.5 cursor-pointer">
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex flex-col">
                <span className="font-medium">{option.label}</span>
                <span className="text-[11px] text-muted-foreground font-normal">{option.description}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
