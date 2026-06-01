import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Loader2, Save, X } from 'lucide-react';
import { useCells } from '@/hooks/useCells';

const empty = { name: '', email: '', cells: [], active: true };

export default function ManagerForm({ editing, onSubmit, onCancel, saving }) {
  const { activeCells } = useCells();
  const [data, setData] = useState(empty);

  useEffect(() => {
    if (editing) setData({ ...empty, ...editing, cells: editing.cells || [] });
    else setData(empty);
  }, [editing]);

  const toggleCell = (name) => {
    setData((d) => ({
      ...d,
      cells: d.cells.includes(name) ? d.cells.filter((c) => c !== name) : [...d.cells, name],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    await onSubmit({ name: data.name, email: data.email, cells: data.cells, active: data.active });
    if (!editing) setData(empty);
  };

  return (
    <Card className="p-6 border-border/60">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Nome do gestor</Label>
            <Input value={data.name} onChange={(e) => setData((d) => ({ ...d, name: e.target.value }))} placeholder="Ex: João Silva" required />
          </div>
          <div className="space-y-2">
            <Label>E-mail</Label>
            <Input type="email" value={data.email} onChange={(e) => setData((d) => ({ ...d, email: e.target.value }))} placeholder="gestor@empresa.com" required />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Células monitoradas</Label>
          <p className="text-xs text-muted-foreground">Selecione as células deste gestor. Se nenhuma for marcada, ele recebe alertas de todas.</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {activeCells.length === 0 && <span className="text-sm text-muted-foreground">Cadastre células primeiro.</span>}
            {activeCells.map((c) => {
              const sel = data.cells.includes(c.name);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCell(c.name)}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                    sel ? 'bg-primary text-primary-foreground border-primary' : 'bg-transparent text-muted-foreground border-border hover:bg-secondary'
                  }`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          {editing && (
            <Button type="button" variant="outline" onClick={onCancel} className="gap-2">
              <X className="w-4 h-4" /> Cancelar
            </Button>
          )}
          <Button type="submit" disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {editing ? 'Salvar alterações' : 'Cadastrar gestor'}
          </Button>
        </div>
      </form>
    </Card>
  );
}