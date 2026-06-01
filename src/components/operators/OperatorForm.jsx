import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserPlus, Save, X } from 'lucide-react';

const SHIFTS = ['1º Turno', '2º Turno', '3º Turno'];

const empty = { name: '', registration: '', cells: [], shift: '', active: true };

export default function OperatorForm({ operator, cells = [], onSubmit, onCancel, saving }) {
  const [form, setForm] = useState(empty);

  useEffect(() => {
    setForm(operator ? { ...empty, ...operator, cells: operator.cells || [] } : empty);
  }, [operator]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const toggleCell = (cell) => {
    setForm((f) => ({
      ...f,
      cells: f.cells.includes(cell) ? f.cells.filter((c) => c !== cell) : [...f.cells, cell],
    }));
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit({
      name: form.name.trim(),
      registration: form.registration?.trim() || '',
      cells: form.cells,
      shift: form.shift || undefined,
      active: form.active,
    });
  };

  return (
    <Card className="p-6 border-border/60">
      <div className="flex items-center gap-2 mb-4">
        <UserPlus className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-semibold">{operator ? 'Editar operador' : 'Novo operador'}</h3>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Nome *</Label>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex: Carlos Silva" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Matrícula</Label>
            <Input value={form.registration} onChange={(e) => set('registration', e.target.value)} placeholder="Ex: 00123" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Turno de trabalho</Label>
          <Select value={form.shift || ''} onValueChange={(v) => set('shift', v)}>
            <SelectTrigger><SelectValue placeholder="Selecione o turno" /></SelectTrigger>
            <SelectContent>
              {SHIFTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Células associadas</Label>
          {cells.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma célula cadastrada ainda.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {cells.map((cell) => {
                const on = form.cells.includes(cell);
                return (
                  <button key={cell} type="button" onClick={() => toggleCell(cell)}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${on ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-secondary'}`}>
                    {cell}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border border-border/60 rounded-xl px-4 py-3">
          <div>
            <p className="font-medium text-sm">Operador ativo</p>
            <p className="text-xs text-muted-foreground">Inativos não aparecem nos filtros.</p>
          </div>
          <Switch checked={form.active} onCheckedChange={(v) => set('active', v)} />
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={saving} className="gap-2">
            <Save className="w-4 h-4" /> {saving ? 'Salvando...' : 'Salvar'}
          </Button>
          {operator && (
            <Button type="button" variant="outline" onClick={onCancel} className="gap-2">
              <X className="w-4 h-4" /> Cancelar
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}