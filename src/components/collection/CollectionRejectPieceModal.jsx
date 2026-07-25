import { useState, useEffect } from 'react';
import { AlertOctagon, RotateCcw, Wrench, ShieldAlert, Lock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { getDefectCatalog } from '@/lib/qualityService';

const FALLBACK_REASONS = [
  { id: '1', name: 'MDF riscado', six_m_category: 'Material' },
  { id: '2', name: 'Peça lascada', six_m_category: 'Material' },
  { id: '3', name: 'Erro de corte', six_m_category: 'Máquina' },
  { id: '4', name: 'Erro de medida', six_m_category: 'Medição' },
  { id: '5', name: 'Erro de furação', six_m_category: 'Máquina' },
  { id: '6', name: 'Erro de CNC', six_m_category: 'Método' },
  { id: '7', name: 'Borda errada', six_m_category: 'Material' },
  { id: '8', name: 'Borda descolada', six_m_category: 'Máquina' },
  { id: '9', name: 'Peça quebrada', six_m_category: 'Mão de obra' },
  { id: '10', name: 'Outro', six_m_category: 'Método' }
];

export default function CollectionRejectPieceModal({
  open,
  onOpenChange,
  piece,
  onSubmit,
  loading = false
}) {
  const [defects, setDefects] = useState(FALLBACK_REASONS);
  const [selectedDefectId, setSelectedDefectId] = useState('');
  const [reason, setReason] = useState(FALLBACK_REASONS[0].name);
  const [notes, setNotes] = useState('');
  const [disposition, setDisposition] = useState('scrap'); // 'scrap' | 'rework' | 'replacement' | 'block'

  useEffect(() => {
    if (open) {
      getDefectCatalog({ activeOnly: true })
        .then((data) => {
          if (data && data.length > 0) {
            setDefects(data);
            setSelectedDefectId(data[0].id);
            setReason(data[0].name);
          }
        })
        .catch((err) => console.error('Erro ao carregar catálogo de defeitos:', err));
    }
  }, [open]);

  const handleDefectChange = (defectId) => {
    setSelectedDefectId(defectId);
    const found = defects.find(d => d.id === defectId);
    if (found) {
      setReason(found.name);
    }
  };

  const handleConfirm = () => {
    if (!reason) return;
    const selectedDefect = defects.find(d => d.id === selectedDefectId);
    onSubmit({
      defect_id: selectedDefectId || null,
      defect_code: selectedDefect?.code || null,
      reason,
      notes,
      disposition,
      action: disposition === 'block' ? 'block' : (disposition === 'rework' ? 'rework' : (disposition === 'replacement' ? 'replacement' : 'reject_only'))
    });
    // Reset form
    setNotes('');
    setDisposition('scrap');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-6 bg-card border border-border/60 rounded-2xl shadow-xl">
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-base font-extrabold flex items-center gap-2 text-rose-600">
            <AlertOctagon className="w-5 h-5 shrink-0" />
            Reprovar Peça de Produção
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            A peça será marcada como reprovada no posto atual e uma Não Conformidade (NC) será gerada automaticamente.
          </DialogDescription>
        </DialogHeader>

        {piece && (
          <div className="bg-secondary/40 p-3 rounded-xl border border-border/40 text-xs space-y-1">
            <p className="font-bold text-foreground font-mono">UID: {piece.piece_uid || piece.traceability_code}</p>
            <p className="text-muted-foreground">Nome: <span className="text-foreground font-semibold">{piece.piece_name || 'N/A'}</span></p>
            <p className="text-muted-foreground">Lote: <span className="text-foreground font-semibold">{piece.lot_code || 'LOTE-N/A'}</span></p>
          </div>
        )}

        <div className="space-y-4 my-4 text-xs">
          {/* Motivo do Catálogo */}
          <div className="space-y-1.5">
            <Label htmlFor="rejection-reason" className="font-bold text-muted-foreground">Motivo do Defeito (Catálogo 6M) *</Label>
            <select
              id="rejection-reason"
              value={selectedDefectId}
              onChange={(e) => handleDefectChange(e.target.value)}
              className="w-full h-10 rounded-xl border border-input bg-background px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {defects.map(d => (
                <option key={d.id} value={d.id}>
                  {d.code ? `[${d.code}] ` : ''}{d.name} ({d.six_m_category || '6M'})
                </option>
              ))}
            </select>
          </div>

          {/* Disposição Recomendada */}
          <div className="space-y-1.5">
            <Label className="font-bold text-muted-foreground block">Disposição da Peça Reprovada</Label>
            <div className="grid grid-cols-1 gap-2">
              <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer select-none transition-all duration-200 ${disposition === 'scrap' ? 'border-rose-500 bg-rose-500/5 text-rose-700 dark:text-rose-400' : 'border-border/60 hover:bg-secondary/35'}`}>
                <input
                  type="radio"
                  name="disposition-action"
                  value="scrap"
                  checked={disposition === 'scrap'}
                  onChange={() => setDisposition('scrap')}
                  className="mt-0.5"
                />
                <div>
                  <p className="font-bold text-xs flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-500" /> Refugar Peça (Scrap)
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">A peça é descartada e contabilizada como refugo do posto.</p>
                </div>
              </label>

              <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer select-none transition-all duration-200 ${disposition === 'replacement' ? 'border-amber-500 bg-amber-500/5 text-amber-700 dark:text-amber-400' : 'border-border/60 hover:bg-secondary/35'}`}>
                <input
                  type="radio"
                  name="disposition-action"
                  value="replacement"
                  checked={disposition === 'replacement'}
                  onChange={() => setDisposition('replacement')}
                  className="mt-0.5"
                />
                <div>
                  <p className="font-bold text-xs flex items-center gap-1.5">
                    <RotateCcw className="w-3.5 h-3.5 text-amber-500" /> Solicitar Reposição de Peça
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Alimenta a fila de Reposição para fabricação de uma nova peça substituta.</p>
                </div>
              </label>

              <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer select-none transition-all duration-200 ${disposition === 'rework' ? 'border-purple-500 bg-purple-500/5 text-purple-700 dark:text-purple-400' : 'border-border/60 hover:bg-secondary/35'}`}>
                <input
                  type="radio"
                  name="disposition-action"
                  value="rework"
                  checked={disposition === 'rework'}
                  onChange={() => setDisposition('rework')}
                  className="mt-0.5"
                />
                <div>
                  <p className="font-bold text-xs flex items-center gap-1.5">
                    <Wrench className="w-3.5 h-3.5 text-purple-500" /> Enviar para Retrabalho
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">A mesma peça retorna ao fluxo para ajuste ou refuração.</p>
                </div>
              </label>

              <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer select-none transition-all duration-200 ${disposition === 'block' ? 'border-slate-500 bg-slate-500/5 text-slate-700 dark:text-slate-400' : 'border-border/60 hover:bg-secondary/35'}`}>
                <input
                  type="radio"
                  name="disposition-action"
                  value="block"
                  checked={disposition === 'block'}
                  onChange={() => setDisposition('block')}
                  className="mt-0.5"
                />
                <div>
                  <p className="font-bold text-xs flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-slate-500" /> Bloquear Lote Produtivo
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Interrompe o lote para análise imediata do Controle de Qualidade.</p>
                </div>
              </label>
            </div>
          </div>

          {/* Observação Opcional */}
          <div className="space-y-1.5">
            <Label htmlFor="rejection-notes" className="font-bold text-muted-foreground">Observações / Detalhes</Label>
            <textarea
              id="rejection-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Descreva detalhes específicos do defeito..."
              className="w-full min-h-[70px] rounded-xl border border-input bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-10 rounded-xl border-border/60 font-bold"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold"
          >
            Confirmar Rejeição
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
