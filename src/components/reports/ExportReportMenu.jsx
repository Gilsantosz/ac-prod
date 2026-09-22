import { Fragment, useId, useRef, useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet, FileText, Loader2, Table2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
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
  reportGroups,
  formats = ['pdf', 'xlsx', 'csv'],
  disabled = false,
  className = '',
  formatExporters = {},
  onSuccess,
  onError,
}) {
  const [activeFormat, setActiveFormat] = useState(null);
  const exportLock = useRef(false);
  const menuId = useId();
  const availableFormats = formats.filter((format) => REPORT_FORMAT_OPTIONS[format]);
  // Existing consumers retain the same one-report menu. The dashboard can expose
  // several periods without duplicating buttons, download logic or export locks.
  const groups = reportGroups ?? [{ id: 'default', label: 'Escolha a finalidade', report, getReport }];
  const canExportGroup = (group) => !disabled && !group.disabled && Boolean(group.report || group.getReport);

  const handleExport = async (format, group) => {
    if (!canExportGroup(group) || exportLock.current) return;
    exportLock.current = true;
    setActiveFormat(format);
    const toastId = `report-export-${group.report?.id || 'async'}-${group.id}`;
    toast.loading(PROGRESS_LABELS[format], { id: toastId });
    try {
      const resolvedReport = group.getReport ? await group.getReport(format) : group.report;
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
          disabled={!groups.some(canExportGroup) || isLoading || availableFormats.length === 0}
          className={`gap-2 bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-full shadow-sm ${className}`}
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Exportar
          <ChevronDown className="w-3.5 h-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-1rem)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto">
        {groups.map((group, index) => (
          <Fragment key={group.id}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup aria-labelledby={`${menuId}-${index}`}>
              <DropdownMenuLabel id={`${menuId}-${index}`}>
                {group.label}
                {group.description && <span className="block text-[11px] font-normal text-muted-foreground">{group.description}</span>}
                {group.disabled && <span className="block text-[11px] font-normal text-muted-foreground">Sem dados neste período</span>}
              </DropdownMenuLabel>
              {availableFormats.map((format) => {
                const Icon = FORMAT_ICONS[format];
                const option = REPORT_FORMAT_OPTIONS[format];
                return (
                  <DropdownMenuItem
                    key={format}
                    disabled={isLoading || !canExportGroup(group)}
                    onSelect={() => handleExport(format, group)}
                    className="gap-3 py-2.5 cursor-pointer"
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="flex flex-col">
                      <span className="font-medium">{option.label}</span>
                      <span className="text-[11px] text-muted-foreground font-normal">{option.description}</span>
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
