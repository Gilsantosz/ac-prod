import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserPlus, Save, X, AlertCircle } from 'lucide-react';

const SHIFTS = ['1º Turno', '2º Turno', '3º Turno'];

const empty = {
  name: '',
  registration: '',
  cells: [],
  shift: '',
  primary_cell: '',
  login_enabled: true,
  active: true,
};

export default function OperatorForm({ operator, cells = [], onSubmit, onCancel, saving }) {
  const [form, setForm] = useState(empty);

  useEffect(() => {
    setForm(
      operator
        ? {
            ...empty,
            ...operator,
            cells: operator.cells || [],
            primary_cell: operator.primary_cell || '',
            login_enabled: operator.login_enabled !== false,
          }
        : empty
    );
  }, [operator]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const toggleCell = (cell) => {
    setForm((f) => ({
      ...f,
      cells: f.cells.includes(cell) ? f.cells.filter((c) => c !== cell) : [...f.cells, cell],
    }));
  };

  const missingReg = form.login_enabled && !form.registration?.trim();
  const missingCell = form.login_enabled && !form.primary_cell;

  const submit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (missingReg || missingCell) return;
    onSubmit({
      name: form.name.trim(),
      registration: form.registration?.trim() || '',
      cells: form.cells,
      primary_cell: form.primary_cell || null,
      shift: form.shift || undefined,
      login_enabled: form.login_enabled,
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
            <Label className="text-xs">Nome * <span className="text-muted-foreground">(usado como login)</span></Label>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex: Carlos Silva" required />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              Matrícula {form.login_enabled && <span className="text-red-500">*</span>}
              <span className="text-muted-foreground ml-1">(senha operacional)</span>
            </Label>
            <Input
              value={form.registration}
              onChange={(e) => set('registration', e.target.value)}
              placeholder="Ex: 00123"
              required={form.login_enabled}
            />
            {missingReg && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Matrícula obrigatória para login habilitado.
              </p>
            )}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Turno de trabalho</Label>
            <Select value={form.shift || ''} onValueChange={(v) => set('shift', v)}>
              <SelectTrigger><SelectValue placeholder="Selecione o turno" /></SelectTrigger>
              <SelectContent>
                {SHIFTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">
              Célula principal {form.login_enabled && <span className="text-red-500">*</span>}
            </Label>
            <Select value={form.primary_cell || ''} onValueChange={(v) => set('primary_cell', v)}>
              <SelectTrigger><SelectValue placeholder="Selecione a célula" /></SelectTrigger>
              <SelectContent>
                {cells.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            {missingCell && (
              <p className="text-xs text-red-500 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Célula obrigatória para login habilitado.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Células associadas (todas)</Label>
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

        {/* Login habilitado */}
        <div className="flex items-center justify-between border border-border/60 rounded-xl px-4 py-3">
          <div>
            <p className="font-medium text-sm">Login habilitado</p>
            <p className="text-xs text-muted-foreground">Permite acesso à tela de produção com nome e matrícula.</p>
          </div>
          <Switch checked={form.login_enabled} onCheckedChange={(v) => set('login_enabled', v)} />
        </div>

        {/* Ativo */}
        <div className="flex items-center justify-between border border-border/60 rounded-xl px-4 py-3">
          <div>
            <p className="font-medium text-sm">Operador ativo</p>
            <p className="text-xs text-muted-foreground">Inativos não aparecem nos filtros.</p>
          </div>
          <Switch checked={form.active} onCheckedChange={(v) => set('active', v)} />
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={saving || missingReg || missingCell} className="gap-2">
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