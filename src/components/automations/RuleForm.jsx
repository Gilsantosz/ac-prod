import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus } from 'lucide-react';
import { METRIC_LABELS, OPERATOR_LABELS, ACTION_LABELS } from '@/lib/automationRules';

const EMPTY = {
  name: '',
  metric: 'efficiency',
  operator: 'lt',
  threshold: '',
  cell: '',
  action: 'alert',
  occurrenceReason: 'Outros',
};

export default function RuleForm({ onSubmit, saving, cells = [] }) {
  const [form, setForm] = useState(EMPTY);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name || form.threshold === '') return;
    await onSubmit({
      ...form,
      threshold: Number(form.threshold),
      active: true,
      cell: form.cell === 'all' ? '' : form.cell,
    });
    setForm(EMPTY);
  };

  return (
    <Card className="p-5">
      <h2 className="font-semibold mb-4">Nova Regra de Automação</h2>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="space-y-1.5 lg:col-span-3">
          <Label>Nome da regra</Label>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Ex: Alerta de eficiência baixa" />
        </div>

        <div className="space-y-1.5">
          <Label>Métrica</Label>
          <Select value={form.metric} onValueChange={(v) => set('metric', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(METRIC_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Condição</Label>
          <Select value={form.operator} onValueChange={(v) => set('operator', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(OPERATOR_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Valor limite</Label>
          <Input type="number" value={form.threshold} onChange={(e) => set('threshold', e.target.value)} placeholder="0" />
        </div>

        <div className="space-y-1.5">
          <Label>Célula</Label>
          <Select value={form.cell || 'all'} onValueChange={(v) => set('cell', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as células</SelectItem>
              {cells.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Ação</Label>
          <Select value={form.action} onValueChange={(v) => set('action', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(ACTION_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {form.action === 'log_occurrence' && (
          <div className="space-y-1.5">
            <Label>Motivo da ocorrência</Label>
            <Input value={form.occurrenceReason} onChange={(e) => set('occurrenceReason', e.target.value)} placeholder="Ex: Qualidade / Refugo" />
          </div>
        )}

        <div className="flex items-end lg:col-span-3">
          <Button type="submit" disabled={saving} className="gap-2">
            <Plus className="w-4 h-4" /> {saving ? 'Salvando...' : 'Criar regra'}
          </Button>
        </div>
      </form>
    </Card>
  );
}