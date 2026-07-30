import { useState, useEffect } from 'react';
import {
  Settings, Save
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { getLabelTemplates } from '@/lib/replacementLabelService';

export default function LabelTemplateConfigModal({
  open,
  onOpenChange
}) {
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [widthMm, setWidthMm] = useState(100);
  const [heightMm, setHeightMm] = useState(50);
  const [dpi, setDpi] = useState(203);

  useEffect(() => {
    if (open) {
      getLabelTemplates().then(list => {
        setTemplates(list);
        if (list.length > 0) {
          const def = list.find(t => t.is_default) || list[0];
          setSelectedTemplateId(def.id);
          setWidthMm(def.width_mm || 100);
          setHeightMm(def.height_mm || 50);
        }
      });
    }
  }, [open]);

  const handleSave = () => {
    toast.success('Configurações do modelo de etiqueta térmica salvas.');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl p-6 border-border bg-card shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-base font-black text-foreground flex items-center gap-2">
            <Settings className="w-5 h-5 text-amber-500" />
            Configuração de Modelos de Etiqueta Térmica
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            Ajuste de dimensões, resolução DPI e margens de corte para impressoras industriais.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-3 text-xs">
          <div>
            <Label className="font-bold text-muted-foreground">Modelo Selecionado:</Label>
            <select
              value={selectedTemplateId}
              onChange={(e) => {
                setSelectedTemplateId(e.target.value);
                const sel = templates.find(t => t.id === e.target.value);
                if (sel) {
                  setWidthMm(sel.width_mm);
                  setHeightMm(sel.height_mm);
                }
              }}
              className="w-full mt-1.5 h-10 rounded-xl border border-input bg-background px-3 text-xs font-medium"
            >
              {templates.map(t => (
                <option key={t.id} value={t.id}>{t.name} {t.is_default ? '(Padrão do Sistema)' : ''}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="font-bold text-muted-foreground">Largura (mm):</Label>
              <Input
                type="number"
                value={widthMm}
                onChange={(e) => setWidthMm(parseFloat(e.target.value) || 100)}
                className="mt-1.5 h-10 rounded-xl text-xs font-bold"
              />
            </div>
            <div>
              <Label className="font-bold text-muted-foreground">Altura (mm):</Label>
              <Input
                type="number"
                value={heightMm}
                onChange={(e) => setHeightMm(parseFloat(e.target.value) || 50)}
                className="mt-1.5 h-10 rounded-xl text-xs font-bold"
              />
            </div>
          </div>

          <div>
            <Label className="font-bold text-muted-foreground">Resolução Térmica (DPI):</Label>
            <select
              value={dpi}
              onChange={(e) => setDpi(parseInt(e.target.value) || 203)}
              className="w-full mt-1.5 h-10 rounded-xl border border-input bg-background px-3 text-xs font-medium"
            >
              <option value={203}>203 DPI (Padrão Zebra / Argox / Elgin)</option>
              <option value={300}>300 DPI (Alta Resolução TSC / Datamax)</option>
            </select>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-9 rounded-xl text-xs font-bold"
          >
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            className="h-9 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white flex items-center gap-1.5"
          >
            <Save className="w-4 h-4" />
            Salvar Padrão
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
