import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/lib/localDb';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save, Clock, Zap, Factory } from 'lucide-react';
import { format } from 'date-fns';
import { useCells } from '@/hooks/useCells';
import { useAuth } from '@/lib/AuthContext';
import ProductionIdentitySection from '@/components/entry/ProductionIdentitySection';

const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

// Deduz o turno a partir do horário atual do sistema
function getCurrentShift() {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return '1º Turno';
  if (h >= 14 && h < 22) return '2º Turno';
  return '3º Turno';
}

// Retorna a hora atual no formato HH:00
function getCurrentHour() {
  return `${String(new Date().getHours()).padStart(2, '0')}:00`;
}

// Retorna a data atual no formato yyyy-MM-dd
function getTodayStr() {
  return format(new Date(), 'yyyy-MM-dd');
}

function buildInitialState(user) {
  return {
    date: getTodayStr(),
    shift: getCurrentShift(),
    cell: user?.cell || '',
    hour: getCurrentHour(),
    hours: '',
    produced: '',
    target: '',
    scrap: '',
    downtime: '',
    operator: user?.role !== 'admin' ? (user?.name || '') : '',
    notes: '',
    production_order_id: null,
    order_id: null,
    lot_id: null,
    order_item_id: null,
    system_order_number: '',
    customer_order_number: '',
    order_number: '',
    load_number: '',
    lot_code: '',
    customer_code: '',
    customer_legal_name: '',
    customer_trade_name: '',
    customer_name: '',
    cnpj: '',
    product_code: '',
    product_name: '',
    product_description: '',
    route_code: '',
    route_name: '',
    process_step: '',
    finalization_date: '',
    city: '',
    state: '',
    delivery_region: '',
    mirror_quantity: 0,
    pallet_number: '',
    traceability_status: 'limited',
  };
}

export default function ProductionForm({ onSubmit, saving }) {
  const { user } = useAuth();
  const { activeCells, getShiftHours, getCell } = useCells();
  const [data, setData] = useState(() => buildInitialState(user));
  const [validationMessage, setValidationMessage] = useState('');
  const set = (k, v) => {
    setValidationMessage('');
    setData((d) => ({ ...d, [k]: v }));
  };
  const initializedRef = useRef(false);

  // ─── Autopreenchimento ao carregar o perfil do usuário ───────────────────────
  // Só inicializa UMA vez quando o objeto `user` fica disponível pela primeira vez.
  useEffect(() => {
    if (!user || initializedRef.current) return;
    initializedRef.current = true;

    setData(buildInitialState(user));
  }, [user]);

  // ─── Atualiza hora e data automaticamente em tempo real ─────────────────────
  // Tick a cada 30 s para manter o horário de registro correto sem intervenção.
  useEffect(() => {
    const tick = () => {
      setData((prev) => ({
        ...prev,
        // Só atualiza se o usuário não editou manualmente estes campos
        date: prev._dateEdited ? prev.date : getTodayStr(),
        shift: prev._shiftEdited ? prev.shift : getCurrentShift(),
        hour: prev._hourEdited ? prev.hour : getCurrentHour(),
      }));
    };
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  // ─── Ao selecionar célula, traz notas cadastradas ────────────────────────────
  useEffect(() => {
    if (!data.cell) return;
    const cell = getCell(data.cell);
    if (cell?.notes) {
      setData((d) => ({ ...d, notes: d.notes || cell.notes }));
    }
  }, [data.cell]);  

  // ─── Ao mudar célula ou turno, busca as horas cadastradas do turno ──────────
  useEffect(() => {
    if (!data.cell) return;
    const h = getShiftHours(data.cell, data.shift);
    if (h != null) setData((d) => ({ ...d, hours: String(h) }));
  }, [data.cell, data.shift]);  

  // ─── Calcula a meta/hora a partir da meta diária cadastrada ─────────────────
  useEffect(() => {
    let ignore = false;
    const hours = Number(data.hours);

    async function suggestTarget() {
      if (!data.cell || !data.date || !hours) return;
      const goals = await base44.entities.DailyGoal.filter({
        date: data.date,
        shift: data.shift,
        cell: data.cell,
      });
      if (ignore) return;
      const goal = goals[0];
      if (goal && Number(goal.target) > 0 && hours > 0) {
        const perHour = Math.round(Number(goal.target) / hours);
        setData((d) => ({ ...d, target: String(perHour) }));
      }
    }

    suggestTarget();
    return () => { ignore = true; };
  }, [data.cell, data.shift, data.date, data.hours]);

  // ─── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    const numericFields = ['produced', 'target', 'scrap', 'downtime', 'hours'];
    if (numericFields.some((field) => data[field] !== '' && Number(data[field]) < 0)) {
      setValidationMessage('Os valores de produção não podem ser negativos.');
      return;
    }
    if (Number(data.scrap) > 0 && !data.notes.trim()) {
      setValidationMessage('Informe uma observação para registrar refugos.');
      return;
    }
    if (Number(data.downtime) > 0 && !data.notes.trim()) {
      setValidationMessage('Informe o motivo ou a ocorrência da parada.');
      return;
    }

    await onSubmit({
      ...data,
      produced: Number(data.produced) || 0,
      target: Number(data.target) || 0,
      scrap: Number(data.scrap) || 0,
      downtime: Number(data.downtime) || 0,
      mirror_quantity: Number(data.mirror_quantity) || 0,
      entry_mode: 'manual',
      source: 'manual_entry',
      approval_status: data.approval_status || 'valid',
      order_number: data.order_number || 'MANUAL',
      lot_code: data.lot_code || 'SEM_LOTE',
      product_name: data.product_name || 'Não informado',
      customer_name: data.customer_name || data.customer_trade_name || 'Não informado',
      process_step: data.process_step || data.cell || 'APONTAMENTO_MANUAL',
    });

    // Preservar campos de contexto para o próximo lançamento
    setData((prev) => ({
      ...buildInitialState(user),
      date: getTodayStr(),
      shift: getCurrentShift(),
      cell: prev.cell,
      hours: prev.hours,
      target: prev.target,
      operator: prev.operator,
      hour: getCurrentHour(),
      production_order_id: prev.production_order_id,
      order_id: prev.order_id,
      lot_id: prev.lot_id,
      order_item_id: prev.order_item_id,
      system_order_number: prev.system_order_number,
      customer_order_number: prev.customer_order_number,
      order_number: prev.order_number,
      load_number: prev.load_number,
      lot_code: prev.lot_code,
      customer_code: prev.customer_code,
      customer_legal_name: prev.customer_legal_name,
      customer_trade_name: prev.customer_trade_name,
      customer_name: prev.customer_name,
      cnpj: prev.cnpj,
      product_code: prev.product_code,
      product_name: prev.product_name,
      product_description: prev.product_description,
      route_code: prev.route_code,
      route_name: prev.route_name,
      process_step: prev.process_step,
      finalization_date: prev.finalization_date,
      city: prev.city,
      state: prev.state,
      delivery_region: prev.delivery_region,
      mirror_quantity: prev.mirror_quantity,
      pallet_number: prev.pallet_number,
      traceability_status: prev.traceability_status,
      _productionContext: prev._productionContext,
    }));
    setValidationMessage('');
  };

  // ─── Indicador de preenchimento automático ───────────────────────────────────
  const hasAutoFill = user?.cell || (user && user.role !== 'admin');
  const efficiency = Number(data.target) > 0 && Number(data.produced) >= 0
    ? (Number(data.produced) / Number(data.target)) * 100
    : null;

  return (
    <Card className="p-6 border-border/60">
      {hasAutoFill && (
        <div className="flex items-center gap-2 mb-5 px-3 py-2 rounded-lg bg-primary/5 border border-primary/20 text-xs text-primary font-medium">
          <Zap className="w-3.5 h-3.5 shrink-0" />
          <span>
            Campos preenchidos automaticamente com base no seu perfil.
            {user?.cell && <> Célula vinculada: <strong>{user.cell}</strong>.</>}
            {' '}Você pode editar qualquer campo.
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Linha 1: Data, Turno, Célula, Hora */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              Data
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
            <Label className="flex items-center gap-1.5">
              Turno
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

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              Célula
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
            <Label className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              Hora do Registro
              <span className="text-[10px] text-muted-foreground font-normal">(automático)</span>
            </Label>
            <Select
              value={data.hour}
              onValueChange={(v) => setData((d) => ({ ...d, hour: v, _hourEdited: true }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {HOURS.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <ProductionIdentitySection value={data} onChange={setData} />

        {/* ═══ CAMPO PRINCIPAL: PRODUZIDO ═══ */}
        <div className="relative rounded-2xl border-2 border-primary bg-gradient-to-br from-primary/8 via-primary/5 to-transparent p-5 shadow-sm overflow-hidden">
          {/* Glow decorativo */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent rounded-2xl pointer-events-none" />
          <div className="absolute -top-8 -right-8 w-32 h-32 bg-primary/10 rounded-full blur-2xl pointer-events-none" />

          <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
            {/* Ícone e título */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center shadow-md shadow-primary/30">
                <Factory className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-foreground">Produzido</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary text-primary-foreground tracking-wide uppercase">
                    Campo Principal
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Quantidade de peças produzidas nesta hora
                </p>
              </div>
            </div>

            {/* Input gigante */}
            <div className="flex-1 flex items-center gap-3">
              <input
                type="number"
                value={data.produced}
                onChange={(e) => set('produced', e.target.value)}
                placeholder="0"
                required
                min="0"
                inputMode="numeric"
                id="produzido-main"
                className="w-full text-center text-5xl font-black tracking-tight text-primary placeholder:text-primary/30 bg-background/70 border-2 border-primary/40 rounded-xl px-4 py-4 focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/20 transition-all duration-200 shadow-inner"
              />
              {data.target && Number(data.produced) > 0 && (
                <div className={`shrink-0 flex flex-col items-center justify-center w-20 h-20 rounded-xl border-2 text-sm font-bold ${
                  Number(data.produced) >= Number(data.target)
                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-400'
                }`}>
                  <span className="text-xs font-semibold opacity-70">Efic.</span>
                  <span className="text-lg">
                    {Math.round((Number(data.produced) / Number(data.target)) * 100)}%
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Linha 2: Horas do turno, Meta, Refugos, Parada — campos secundários */}
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Dados Complementares</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="production-hours" className="flex items-center gap-1.5">
                Horas do Turno
                {data.hours && <span className="text-[10px] text-primary font-normal">(auto)</span>}
              </Label>
              <Input
                id="production-hours"
                type="number"
                step="0.5"
                value={data.hours}
                onChange={(e) => set('hours', e.target.value)}
                placeholder="0"
                min="0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="production-target" className="flex items-center gap-1.5">
                Meta / hora
                {data.target && <span className="text-[10px] text-primary font-normal">(auto)</span>}
              </Label>
              <Input
                id="production-target"
                type="number"
                value={data.target}
                onChange={(e) => set('target', e.target.value)}
                placeholder="0"
                min="0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="production-scrap">Refugos</Label>
              <Input
                id="production-scrap"
                type="number"
                value={data.scrap}
                onChange={(e) => set('scrap', e.target.value)}
                placeholder="0"
                min="0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="production-downtime">Parada (min)</Label>
              <Input
                id="production-downtime"
                type="number"
                value={data.downtime}
                onChange={(e) => set('downtime', e.target.value)}
                placeholder="0"
                min="0"
              />
            </div>
          </div>
        </div>

        {data.cell && (
          <p className="text-xs text-muted-foreground bg-muted/40 px-3 py-2 rounded-lg">
            Horas e meta preenchidas automaticamente a partir da célula{' '}
            <span className="font-semibold text-foreground">{data.cell}</span> + turno{' '}
            <span className="font-semibold text-foreground">{data.shift}</span>. Edite se necessário.
          </p>
        )}

        {/* Linha 4: Operador e Observações */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="production-operator" className="flex items-center gap-1.5">
              Operador
              {user?.role !== 'admin' && user?.name && (
                <span className="text-[10px] text-primary font-normal">(do perfil)</span>
              )}
            </Label>
            <Input
              id="production-operator"
              value={data.operator}
              onChange={(e) => set('operator', e.target.value)}
              placeholder="Nome do operador"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="production-notes">Observações</Label>
            <Textarea
              id="production-notes"
              value={data.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Notas..."
              className="min-h-[40px]"
            />
          </div>
        </div>

        {efficiency !== null && efficiency < 70 && (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Eficiência abaixo de 70%. Verifique a produção e registre observações quando necessário.
          </div>
        )}

        {validationMessage && (
          <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
            {validationMessage}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={saving} className="gap-2 px-6">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Registrar Produção
          </Button>
        </div>
      </form>
    </Card>
  );
}
