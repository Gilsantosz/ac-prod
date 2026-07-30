import { useState, useEffect, useRef } from 'react';
import {
  Printer, CheckCircle2, RotateCcw, Download, Lock
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  validateReplacementLabelData,
  recordReplacementLabelPrint,
  getReplacementLabelPrintHistory,
  buildReplacementTraceCode
} from '@/lib/replacementLabelService';
import { generateCode128Svg } from '@/lib/barcodeGenerator';
import { generateReplacementPdfReport } from '@/lib/reports/replacementPdfReportService';
import { formatPieceFullContext } from '@/lib/pieceFormat';

const REPRINT_REASONS = [
  'Etiqueta danificada no manuseio',
  'Impressão ilegível / falha de fita térmica',
  'Etiqueta perdida no chão de fábrica',
  'Falha mecânica da impressora',
  'Alteração autorizada de dados da peça',
  'Reimpressão solicitada pela liderança',
  'Outro motivo (especificar abaixo)'
];

export default function ReplacementLabelPreviewModal({
  open,
  onOpenChange,
  order,
  userPermissions = {},
  onPrinted = () => {}
}) {
  const [template, setTemplate] = useState('100x50');
  const [copies, setCopies] = useState(1);
  const [printerName, setPrinterName] = useState('Impressora Térmica Zebra (203 DPI)');
  const [isPrinting, setIsPrinting] = useState(false);
  const [printHistory, setPrintHistory] = useState([]);
  
  // Modal de Reimpressão (2ª+ via)
  const [showReprintDialog, setShowReprintDialog] = useState(false);
  const [reprintReason, setReprintReason] = useState(REPRINT_REASONS[0]);
  const [reprintCustomNote, setReprintCustomNote] = useState('');

  const printAreaRef = useRef(null);

  const origPiece = order?.original_piece || {};
  const replPiece = order?.replacement_piece || {};

  // Validação de Dados para Liberação de Impressão
  const validation = validateReplacementLabelData(order, origPiece, replPiece);

  // Código de rastreio oficial da reposição
  const traceCode = replPiece.traceability_code || replPiece.piece_uid || buildReplacementTraceCode(origPiece, (printHistory.length || 0) + 1);

  // Lotes
  const generalLot = order?.lot_code || origPiece.general_lot_code || origPiece.lot_code || '26072640';
  const customerLot = order?.order_number || origPiece.order_number || origPiece.customer_lot_code || '940002';

  // CONTEXTO COMPLETO PROMOB (Linha 1: Peça/Rota/Medidas | Linha 2: Matéria-Prima/Chapa/Fita)
  const fullContext = formatPieceFullContext(origPiece);

  const isCancelled = order?.status === 'cancelled';
  const currentViaNumber = (printHistory.length || 0) + 1;
  const viaLabel = currentViaNumber === 1 ? '1ª VIA' : `${currentViaNumber}ª VIA`;

  const orderDateFormatted = order?.created_at
    ? format(new Date(order.created_at), 'dd/MM/yyyy')
    : format(new Date(), 'dd/MM/yyyy');

  useEffect(() => {
    if (open && order?.id) {
      getReplacementLabelPrintHistory(order.id).then(setPrintHistory);
    }
  }, [open, order?.id]);

  // Gerar SVG do Código de Barras Code 128 (Compacto para abrir espaço para o contexto completo)
  const barcodeSvg = generateCode128Svg(traceCode, {
    height: 28,
    barWidth: 1.7,
    quietZone: 4,
    showText: true,
    fontSize: 9
  });

  const handlePrintClick = () => {
    if (isCancelled || !validation.isValid) {
      toast.error('Etiqueta cancelada ou com pendências cadastrais.');
      return;
    }

    if (currentViaNumber > 1) {
      setShowReprintDialog(true);
    } else {
      executePrint();
    }
  };

  const executePrint = async (reason = null, customNote = null) => {
    setIsPrinting(true);
    try {
      await recordReplacementLabelPrint({
        replacementOrderId: order.id,
        reprintReason: reason,
        reprintReasonDetails: customNote,
        printerName,
        userName: 'Operador MES'
      });

      toast.success(`Etiqueta de reposição enviada para impressão (${viaLabel}).`);
      
      // Disparar impressão do navegador
      setTimeout(() => {
        window.print();
      }, 300);

      onPrinted();
      onOpenChange(false);
    } catch (err) {
      console.error('Erro ao imprimir etiqueta:', err);
      toast.error(err.message || 'Falha ao registrar impressão.');
    } finally {
      setIsPrinting(false);
      setShowReprintDialog(false);
    }
  };

  const handleExportPdfReport = async () => {
    try {
      await generateReplacementPdfReport({
        singleOrder: order,
        reportType: 'individual'
      });
      toast.success('Relatório PDF individual gerado com sucesso.');
    } catch (err) {
      console.error('Erro ao gerar relatório PDF:', err);
      toast.error('Falha ao gerar relatório PDF da reposição.');
    }
  };

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl rounded-3xl p-0 overflow-hidden border-border bg-card shadow-2xl">
        <DialogHeader className="p-4 md:p-6 border-b border-border/60 bg-muted/30">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg md:text-xl font-black text-foreground flex items-center gap-2">
              <Printer className="w-5 h-5 text-amber-500" />
              Etiqueta Térmica de Reposição Promob (100 × 50 mm)
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            Pré-visualização técnica oficial da etiqueta de chão de fábrica com contexto completo Promob e Code 128.
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 md:p-6 space-y-6">
          {/* Painel de Controles e Modelos */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-secondary/30 p-3.5 rounded-2xl border border-border/40">
            <div>
              <Label className="text-[11px] font-bold text-muted-foreground">Modelo da Etiqueta:</Label>
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                className="w-full mt-1 h-9 rounded-xl border border-input bg-background px-3 text-xs font-medium"
              >
                <option value="100x50">Reposição Promob 100 × 50 mm (Padrão)</option>
                <option value="100x70">Reposição Promob 100 × 70 mm</option>
                <option value="80x50">Reposição Compacta 80 × 50 mm</option>
                <option value="60x40">Reposição Compacta 60 × 40 mm</option>
                <option value="a4">Folha A4 (Múltiplas Etiquetas)</option>
              </select>
            </div>

            <div>
              <Label className="text-[11px] font-bold text-muted-foreground">Impressora Térmica:</Label>
              <select
                value={printerName}
                onChange={(e) => setPrinterName(e.target.value)}
                className="w-full mt-1 h-9 rounded-xl border border-input bg-background px-3 text-xs font-medium"
              >
                <option value="Zebra 203 DPI">Zebra ZT230 / ZD220 (203 DPI)</option>
                <option value="Argox OS-214">Argox OS-214 Plus (203 DPI)</option>
                <option value="Elgin L42PRO">Elgin L42PRO (203 DPI)</option>
                <option value="TSC 300 DPI">TSC TE200 / TC300 (300 DPI)</option>
                <option value="Navegador Standard">Impressão Padrão via Navegador / PDF</option>
              </select>
            </div>

            <div>
              <Label className="text-[11px] font-bold text-muted-foreground">Quantidade de Cópias:</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={copies}
                onChange={(e) => setCopies(parseInt(e.target.value) || 1)}
                className="mt-1 h-9 rounded-xl text-xs"
              />
            </div>
          </div>

          {/* Status de Validação */}
          {!validation.isValid ? (
            <div className="bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-400 p-3.5 rounded-2xl text-xs space-y-1.5">
              <div className="font-extrabold flex items-center gap-1.5">
                <Lock className="w-4 h-4" />
                Etiqueta Não Liberada
              </div>
              <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                {validation.issues.map((issue, idx) => (
                  <li key={idx}>{issue}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 p-2.5 rounded-2xl text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Etiqueta pronta para identificação imediata da peça. <strong>Via: {viaLabel}</strong></span>
            </div>
          )}

          {/* ÁREA DE PRÉ-VISUALIZAÇÃO DA ETIQUETA 100 x 50 mm COM CONTEXTO PROMOB COMPLETO */}
          <div className="flex flex-col items-center justify-center p-4 bg-slate-100 dark:bg-slate-900 rounded-2xl border border-border/60">
            <p className="text-[11px] font-bold text-muted-foreground mb-3 uppercase tracking-wider">
              Proporção Real em Tela (100 mm × 50 mm)
            </p>

            <div
              ref={printAreaRef}
              id="thermal-label-printable-area"
              className="relative w-[380px] h-[190px] bg-white text-black p-2.5 border-2 border-black rounded-none flex flex-col justify-between select-none overflow-hidden shadow-md"
              style={{ fontFamily: 'Arial, sans-serif' }}
            >
              {/* LINHA 1 — REPOSIÇÃO E VIA */}
              <div className="flex items-center justify-between border-b border-black pb-0.5">
                <span className="text-xs font-black tracking-widest uppercase">REPOSIÇÃO</span>
                <span className="text-xs font-black tracking-wider uppercase">{viaLabel}</span>
              </div>

              {/* LINHA 2 — NÚMERO DE RASTREIO */}
              <div className="mt-0.5">
                <div className="text-[7.5px] font-bold uppercase tracking-wider text-slate-700">
                  NÚMERO DE RASTREIO
                </div>
                <div className="text-[11px] font-black tracking-wider text-black">
                  {traceCode}
                </div>
              </div>

              {/* LINHA 3 — CÓDIGO DE BARRAS CODE 128 */}
              <div className="flex flex-col items-center justify-center my-0.5">
                <div
                  className="w-full flex justify-center overflow-hidden"
                  dangerouslySetInnerHTML={{ __html: barcodeSvg }}
                />
              </div>

              {/* LINHA 4 — LOTES GERAL E CLIENTE */}
              <div className="grid grid-cols-2 gap-2 border-t border-b border-black py-0.5 text-[9px]">
                <div>
                  <div className="text-[7px] font-bold text-slate-700 uppercase">LOTE GERAL</div>
                  <div className="font-black text-[10px] truncate">{generalLot}</div>
                </div>
                <div>
                  <div className="text-[7px] font-bold text-slate-700 uppercase">LOTE DO CLIENTE</div>
                  <div className="font-black text-[10px] truncate">{customerLot}</div>
                </div>
              </div>

              {/* LINHA 5 — DESCRIÇÃO COMPLETA DO PRODUTO PROMOB (LINHA 1 & LINHA 2) */}
              <div className="my-0.5 space-y-0.5">
                <div className="text-[7px] font-bold text-slate-700 uppercase">DESCRIÇÃO DO PRODUTO</div>
                {/* Linha 1: Nome, Rota, Peça e Medidas Principais */}
                <div className="text-[8.5px] font-black leading-tight uppercase line-clamp-1 text-black">
                  {fullContext.header}
                </div>
                {/* Linha 2: Matéria-Prima, Chapa, Fita e Dimensões Brutas */}
                <div className="text-[7.5px] font-bold leading-none uppercase line-clamp-1 text-slate-600">
                  {fullContext.details}
                </div>
              </div>

              {/* LINHA 6 — RODAPÉ COMPLETO */}
              <div className="border-t border-black pt-0.5 text-[7.5px] font-black text-black flex items-center justify-between">
                <span>{order.replacement_code || 'REP-20260730-7006'}</span>
                <span>DESTINO: {order.destination_cell_name || 'CORTE'}</span>
                <span>{orderDateFormatted}</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="p-4 md:p-6 border-t border-border/60 bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPdfReport}
            className="w-full sm:w-auto h-10 rounded-xl text-xs font-bold flex items-center gap-1.5"
          >
            <Download className="w-4 h-4 text-blue-500" />
            Baixar Relatório PDF
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
              disabled={isCancelled || !validation.isValid || isPrinting}
              onClick={handlePrintClick}
              className="w-1/2 sm:w-auto h-10 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white flex items-center justify-center gap-1.5 shadow-md"
            >
              <Printer className="w-4 h-4" />
              {currentViaNumber > 1 ? 'Reimprimir (2ª+ Via)' : 'Imprimir Etiqueta'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      {/* Modal de Confirmação de Motivo de Reimpressão (2ª+ via) */}
      {showReprintDialog && (
        <Dialog open={showReprintDialog} onOpenChange={setShowReprintDialog}>
          <DialogContent className="max-w-md rounded-3xl p-6 border-border bg-card shadow-2xl">
            <DialogHeader>
              <DialogTitle className="text-base font-black flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <RotateCcw className="w-5 h-5" />
                Justificativa Obrigatória para Reimpressão
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-1">
                Esta etiqueta já possui <strong>1 ou mais impressões registradas</strong>. Selecione o motivo para emitir a <strong>{viaLabel}</strong>.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-3 text-xs">
              <div>
                <Label className="font-bold text-muted-foreground">Motivo da Reimpressão:</Label>
                <select
                  value={reprintReason}
                  onChange={(e) => setReprintReason(e.target.value)}
                  className="w-full mt-1.5 h-10 rounded-xl border border-input bg-background px-3 text-xs font-medium"
                >
                  {REPRINT_REASONS.map((r, i) => (
                    <option key={i} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              {reprintReason.includes('Outro motivo') && (
                <div>
                  <Label className="font-bold text-muted-foreground">Especifique o Motivo:</Label>
                  <Input
                    placeholder="Descreva detalhadamente a necessidade de reimpressão..."
                    value={reprintCustomNote}
                    onChange={(e) => setReprintCustomNote(e.target.value)}
                    className="mt-1.5 h-10 rounded-xl text-xs"
                  />
                </div>
              )}
            </div>

            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowReprintDialog(false)}
                className="h-9 rounded-xl text-xs font-bold"
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                disabled={reprintReason.includes('Outro motivo') && !reprintCustomNote.trim()}
                onClick={() => executePrint(reprintReason, reprintCustomNote)}
                className="h-9 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white"
              >
                Confirmar & Reimprimir
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* CSS ESPECÍFICO DE IMPRESSÃO TÉRMICA MONOCROMÁTICA ISOLADA */}
      <style>{`
        @media print {
          @page {
            size: 100mm 50mm;
            margin: 0;
          }
          html, body {
            width: 100mm !important;
            height: 50mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            color: black !important;
            overflow: hidden !important;
          }
          body * {
            visibility: hidden !important;
          }
          #thermal-label-printable-area,
          #thermal-label-printable-area * {
            visibility: visible !important;
          }
          #thermal-label-printable-area {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 100mm !important;
            height: 50mm !important;
            margin: 0 !important;
            padding: 2.5mm 3.5mm !important;
            box-sizing: border-box !important;
            border: 1px solid black !important;
            background: white !important;
            z-index: 999999 !important;
          }
        }
      `}</style>
    </Dialog>
  );
}
