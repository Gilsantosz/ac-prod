import { useState, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save, Zap } from 'lucide-react';
import { format } from 'date-fns';
import { useCells } from '@/hooks/useCells';
import { useAuth } from '@/lib/AuthContext';

const REASONS = [
  'Falta de Material',
  'Manutenção Corretiva',
  'Manutenção Preventiva',
  'Setup / Troca',
  'Falta de Operador',
  'Qualidade / Refugo',
  'Falta de Energia',
  'Outros',
];

// Deduz o turno com base no relógio do sistema
function getCurrentShift() {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return '1º Turno';
  if (h >= 14 && h < 22) return '2º Turno';
  return '3º Turno';
}

function buildInitialState(user) {
  return {
    date: format(new Date(), 'yyyy-MM-dd'),
    shift: getCurrentShift(),
    cell: user?.cell || '',
    reason: 'Falta de Material',
    downtime: '',
    operator: user?.role !== 'admin' ? (user?.name || '') : '',
    notes: '',
  };
}

export default function OccurrenceForm({ onSubmit, saving }) {
  const { user } = useAuth();
  const { activeCells } = useCells();
  const [data, setData] = useState(() => buildInitialState(user));
  const set = (k, v) => setData((d) => ({ ...d, [k]: v }));
  const initializedRef = useRef(false);

  // ─── Autopreenchimento ao carregar perfil do usuário ─────────────────────────
  useEffect(() => {
    if (!user || initializedRef.current) return;
    initializedRef.current = true;
    setData(buildInitialState(user));
  }, [user]);

  // ─── Tick a cada 30s: sincroniza data/turno sem sobrescrever edições ─────────
  useEffect(() => {
    const tick = () => {
      setData((prev) => ({
        ...prev,
        date: prev._dateEdited ? prev.date : format(new Date(), 'yyyy-MM-dd'),
        shift: prev._shiftEdited ? prev.shift : getCurrentShift(),
      }));
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  // ─── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    await onSubmit({ ...data, downtime: Number(data.downtime) || 0 });

    // Preservar contexto para o próximo lançamento
    setData((prev) => ({
      ...buildInitialState(user),
      date: format(new Date(), 'yyyy-MM-dd'),
      shift: getCurrentShift(),
      cell: prev.cell,
    }));
  };

  const hasAutoFill = user?.cell || (user && user.role !== 'admin');

  return (
    <Card className="p-6 border-border/60">
      {hasAutoFill && (
        <div className="flex items-center gap-2 mb-5 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-xs text-primary font-medium">
          <Zap className="w-3.5 h-3.5 shrink-0" />
          <span>
            Campos preenchidos com base no seu perfil.
            {user?.cell && <> Célula vinculada: <strong>{user.cell}</strong>.</>}
            {' '}Você pode editar qualquer campo.
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Linha 1: Data e Turno */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 h-5">
              <span>Data</span>
              <span className="text-[10px] text-muted-foreground font-normal">(automático)</span>
            </Label>
            <Input
              type="date"
              value={data.date}
              onChange={(e) => setData((d) => ({ ...d, date: e.target.value, _dateEdited: true }))}
              required
              className="text-foreground bg-transparent font-medium [color-scheme:light] dark:[color-scheme:dark]"
            />
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 h-5">
              <span>Turno</span>
              <span className="text-[10px] text-muted-foreground font-normal">(automático)</span>
            </Label>
            <Select
              value={data.shift}
              onValueChange={(v) => setData((d) => ({ ...d, shift: v, _shiftEdited: true }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1º Turno">1º Turno</SelectItem>
                <SelectItem value="2º Turno">2º Turno</SelectItem>
                <SelectItem value="3º Turno">3º Turno</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Linha 2: Célula e Parada */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 h-5">
              <span>Célula</span>
              {user?.cell && <span className="text-[10px] text-primary font-normal">(do perfil)</span>}
            </Label>
            <Select value={data.cell} onValueChange={(v) => set('cell', v)} required>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {activeCells.length === 0 && (
                  <SelectItem value="__none" disabled>Cadastre células primeiro</SelectItem>
                )}
                {activeCells.map((c) => (
                  <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 h-5">
              <span>Parada (min)</span>
            </Label>
            <Input
              type="number"
              value={data.downtime}
              onChange={(e) => set('downtime', e.target.value)}
              placeholder="0"
              required
              className="ring-1 ring-destructive/30 focus:ring-destructive"
            />
          </div>
        </div>

        {/* Linha 3: Motivo e Operador */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 h-5">
              <span>Motivo da Parada</span>
            </Label>
            <Select value={data.reason} onValueChange={(v) => set('reason', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5 h-5">
              <span>Operador</span>
              {user?.role !== 'admin' && user?.name && (
                <span className="text-[10px] text-primary font-normal">(do perfil)</span>
              )}
            </Label>
            <Input
              value={data.operator}
              onChange={(e) => set('operator', e.target.value)}
              placeholder="Nome do operador"
            />
          </div>
        </div>

        {/* Detalhes */}
        <div className="space-y-2">
          <Label className="flex items-center gap-1.5 h-5">
            <span>Detalhes</span>
          </Label>
          <Textarea
            value={data.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Descreva a ocorrência..."
            className="min-h-[40px]"
          />
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving} className="gap-2 px-6">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Registrar Ocorrência
          </Button>
        </div>
      </form>
    </Card>
  );
}