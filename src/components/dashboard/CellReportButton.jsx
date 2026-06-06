import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { exportCellReport } from '@/lib/exportCellReport';

export default function CellReportButton({ cells, allEntries, date }) {
  const [open, setOpen] = useState(false);
  const [cell, setCell] = useState('');
  const [busy, setBusy] = useState(false);

  const handleGenerate = () => {
    if (!cell) {
      toast.error('Selecione uma célula');
      return;
    }
    const cellEntries = allEntries.filter((e) => e.cell === cell && (!date || e.date === date));
    if (!cellEntries.length) {
      toast.error('Nenhum registro para esta célula na data selecionada');
      return;
    }
    setBusy(true);
    try {
      exportCellReport(cell, date, allEntries);
      toast.success('Relatório PDF gerado');
      setOpen(false);
    } catch {
      toast.error('Falha ao gerar relatório');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" className="gap-2 bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-full shadow-sm" onClick={() => setOpen(true)}>
        <FileText className="w-4 h-4" /> Gerar Relatório
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerar Relatório da Célula</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Célula</Label>
              <Select value={cell} onValueChange={setCell}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a célula" />
                </SelectTrigger>
                <SelectContent>
                  {cells.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-muted-foreground">
              Data: {date || 'Todas as datas'} — o PDF inclui resumo de eficiência, metas atingidas e observações por turno.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleGenerate} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Gerar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}