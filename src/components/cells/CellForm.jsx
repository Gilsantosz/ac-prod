import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, Factory, X } from 'lucide-react';

const empty = {
  name: '',
  active: true,
  hoursShift1: 8,
  hoursShift2: 8,
  hoursShift3: 8,
  notes: '',
};

export default function CellForm({ onSubmit, saving, editing, onCancel }) {
  const [data, setData] = useState(empty);
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));

  useEffect(() => {
    if (editing) setData({ ...empty, ...editing });
    else setData(empty);
  }, [editing]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await onSubmit({
      ...data,
      hoursShift1: Number(data.hoursShift1) || 0,
      hoursShift2: Number(data.hoursShift2) || 0,
      hoursShift3: Number(data.hoursShift3) || 0,
    });
    if (!editing) setData(empty);
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Nome da célula</Label>
            <Input value={data.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex: Célula A" required />
          </div>
          <div className="space-y-2">
            <Label>Horas 1º Turno</Label>
            <Input type="number" step="0.5" value={data.hoursShift1} onChange={(e) => set('hoursShift1', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Horas 2º Turno</Label>
            <Input type="number" step="0.5" value={data.hoursShift2} onChange={(e) => set('hoursShift2', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Horas 3º Turno</Label>
            <Input type="number" step="0.5" value={data.hoursShift3} onChange={(e) => set('hoursShift3', e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Observações</Label>
          <Input value={data.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Opcional" />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          {editing && (
            <Button type="button" variant="outline" onClick={onCancel} className="gap-2">
              <X className="w-4 h-4" /> Cancelar
            </Button>
          )}
          <Button type="submit" disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Factory className="w-4 h-4" />}
            {editing ? 'Atualizar célula' : 'Cadastrar célula'}
          </Button>
        </div>
      </form>
    </div>
  );
}