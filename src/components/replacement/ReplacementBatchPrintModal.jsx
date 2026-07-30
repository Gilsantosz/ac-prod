import { useState } from 'react';
import {
  Printer, Download, AlertTriangle, Loader2
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { recordReplacementLabelPrint } from '@/lib/replacementLabelService';
import { generateReplacementPdfReport } from '@/lib/reports/replacementPdfReportService';

export default function ReplacementBatchPrintModal({
  open,
  onOpenChange,
  selectedOrders = [],
  userPermissions = {},
  onBatchComplete = () => {}
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const totalCount = selectedOrders.length;
  const approvedOrders = selectedOrders.filter(o => ['approved', 'released', 'in_production', 'completed'].includes(o.status));
  const blockedOrders = selectedOrders.filter(o => ['requested', 'under_review', 'cancelled'].includes(o.status));

  const handleBatchPrint = async () => {
    if (approvedOrders.length === 0) {
      toast.error('Nenhuma das reposições selecionadas está liberada para produção.');
      return;
    }

    setIsProcessing(true);
    setProgress({ current: 0, total: approvedOrders.length });

    let successCount = 0;
    for (let i = 0; i < approvedOrders.length; i++) {
      const order = approvedOrders[i];
      try {
        await recordReplacementLabelPrint({
          replacementOrderId: order.id,
          printerName: 'Impressora Térmica em Lote',
          userName: 'Operador MES'
        });
        successCount++;
      } catch (err) {
        console.error(`Erro ao registrar impressão em lote para ${order.replacement_code}:`, err);
      }
      setProgress({ current: i + 1, total: approvedOrders.length });
    }

    setIsProcessing(false);
    toast.success(`${successCount} etiquetas registradas e enviadas para o spool de impressão em lote.`);
    
    setTimeout(() => {
      window.print();
    }, 300);

    onBatchComplete();
    onOpenChange(false);
  };

  const handleExportPdf = async () => {
    try {
      await generateReplacementPdfReport({
        orders: selectedOrders,
        reportType: 'selected'
      });
      toast.success('Relatório PDF das reposições selecionadas gerado com sucesso.');
      onOpenChange(false);
    } catch (err) {
      console.error('Erro ao gerar relatório PDF em lote:', err);
      toast.error('Falha ao exportar relatório PDF.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-3xl p-6 border-border bg-card shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-black text-foreground flex items-center gap-2">
            <Printer className="w-5 h-5 text-amber-500" />
            Impressão e Exportação em Lote
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            Resumo de validação e emissão industrial para os registros selecionados.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3 text-xs">
          {/* Quadro de Resumo */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-secondary/40 p-3 rounded-2xl border border-border/40">
              <span className="text-[10px] font-bold text-muted-foreground uppercase">Selecionadas</span>
              <p className="text-xl font-black text-foreground">{totalCount}</p>
            </div>
            <div className="bg-emerald-500/10 p-3 rounded-2xl border border-emerald-500/20">
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Prontas p/ Impressão</span>
              <p className="text-xl font-black text-emerald-600 dark:text-emerald-400">{approvedOrders.length}</p>
            </div>
            <div className="bg-amber-500/10 p-3 rounded-2xl border border-amber-500/20">
              <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase">Bloqueadas (S/ Aprovação)</span>
              <p className="text-xl font-black text-amber-600 dark:text-amber-400">{blockedOrders.length}</p>
            </div>
          </div>

          {/* Progresso de Processamento */}
          {isProcessing && (
            <div className="bg-card border border-border/60 p-4 rounded-2xl space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-foreground">
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                  Processando etiquetas em lote...
                </span>
                <span>{progress.current} de {progress.total}</span>
              </div>
              <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-200"
                  style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {blockedOrders.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 p-3 rounded-2xl text-xs space-y-1">
              <div className="font-extrabold flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Aviso de Registros Bloqueados ({blockedOrders.length})
              </div>
              <p className="text-[11px] text-muted-foreground">
                Reposições aguardando aprovação não terão etiquetas válidas impressas. Elas podem ser exportadas apenas no relatório PDF.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPdf}
            className="w-full sm:w-auto h-10 rounded-xl text-xs font-bold flex items-center gap-1.5"
          >
            <Download className="w-4 h-4 text-blue-500" />
            Gerar Relatório PDF Selecionados
          </Button>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="w-1/2 sm:w-auto h-10 rounded-xl text-xs font-bold"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={approvedOrders.length === 0 || isProcessing}
              onClick={handleBatchPrint}
              className="w-1/2 sm:w-auto h-10 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white flex items-center justify-center gap-1.5"
            >
              <Printer className="w-4 h-4" />
              Imprimir {approvedOrders.length} Etiquetas
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
