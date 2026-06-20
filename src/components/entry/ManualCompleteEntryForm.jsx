import { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { base44 } from '@/lib/localDb';
import { supabase } from '@/lib/supabaseClient';
import { format } from 'date-fns';
import { useCells } from '@/hooks/useCells';
import { Loader2, Save, Factory, AlertCircle, Sparkles } from 'lucide-react';

const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

function getCurrentShift() {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return '1º Turno';
  if (h >= 14 && h < 22) return '2º Turno';
  return '3º Turno';
}

function getCurrentHour() {
  return `${String(new Date().getHours()).padStart(2, '0')}:00`;
}

function getTodayStr() {
  return format(new Date(), 'yyyy-MM-dd');
}

export default function ManualCompleteEntryForm({ user = {}, onSubmit = null, saving = false, onContextChange = null }) {
  const { activeCells, getShiftHours, getCell } = useCells();
  const initializedRef = useRef(false);

  // Estados do formulário
  const [date, setDate] = useState(getTodayStr());
  const [shift, setShift] = useState(getCurrentShift());
  const [cell, setCell] = useState(user?.cell || '');
  const [hour, setHour] = useState(getCurrentHour());
  const [hours, setHours] = useState('');
  const [target, setTarget] = useState('');
  
  // Novos campos MES/Rastreabilidade
  const [orderNumber, setOrderNumber] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [productCode, setProductCode] = useState('');
  const [productName, setProductName] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [processStep, setProcessStep] = useState('');
  const [stationName, setStationName] = useState('');
  
  const [produced, setProduced] = useState('0');
  const [scrap, setScrap] = useState('0');
  const [downtime, setDowntime] = useState('0');
  const [operator, setOperator] = useState(user?.role !== 'admin' ? (user?.name || '') : '');
  const [notes, setNotes] = useState('');
  
  const [duplicateAction, setDuplicateAction] = useState('sum');
  
  const [dateEdited, setDateEdited] = useState(false);
  const [shiftEdited, setShiftEdited] = useState(false);
  const [hourEdited, setHourEdited] = useState(false);

  const userRole = user.role || 'operator';
  const canReplaceOrNew = userRole === 'admin' || userRole === 'manager';

  // Inicialização única de acordo com o usuário logado
  useEffect(() => {
    if (!user || initializedRef.current) return;
    initializedRef.current = true;
    
    setCell(user.cell || '');
    setOperator(user.role !== 'admin' ? (user.name || user.email || '') : '');
  }, [user]);

  // Tick a cada 30 segundos para atualizar horário automático se o usuário não tiver alterado manualmente
  useEffect(() => {
    const tick = () => {
      if (!dateEdited) setDate(getTodayStr());
      if (!shiftEdited) setShift(getCurrentShift());
      if (!hourEdited) setHour(getCurrentHour());
    };
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [dateEdited, shiftEdited, hourEdited]);

  // Notificar pai sobre mudança de contexto
  useEffect(() => {
    if (onContextChange) {
      onContextChange({ cell, hour, date, shift });
    }
  }, [cell, hour, date, shift, onContextChange]);

  // Ao alterar célula, puxa as notas padrões se existirem
  useEffect(() => {
    if (!cell) return;
    const activeCell = getCell(cell);
    if (activeCell?.notes) {
      setNotes((prev) => prev || activeCell.notes);
    }
    // Prefill da etapa baseada na célula
    setProcessStep((prev) => prev || cell);
    setStationName((prev) => prev || cell);
  }, [cell]);

  // Busca as horas cadastradas do turno
  useEffect(() => {
    if (!cell) return;
    const h = getShiftHours(cell, shift);
    if (h != null) setHours(String(h));
  }, [cell, shift]);

  // Sugere a meta de produção diária
  useEffect(() => {
    let ignore = false;
    const numericHours = Number(hours);

    async function suggestTarget() {
      if (!cell || !date || !numericHours) return;
      const goals = await base44.entities.DailyGoal.filter({
        date,
        shift,
        cell,
      });
      if (ignore) return;
      const goal = goals[0];
      if (goal && Number(goal.target) > 0 && numericHours > 0) {
        const perHour = Math.round(Number(goal.target) / numericHours);
        setTarget(String(perHour));
      }
    }

    suggestTarget();
    return () => { ignore = true; };
  }, [cell, shift, date, hours]);

  // Ao preencher lote, tenta buscar meta do lote se já existir no banco (MES)
  useEffect(() => {
    if (!lotCode || lotCode === 'SEM_LOTE') return;
    
    async function fetchLotInfo() {
      const { data, error } = await supabase
        .from('production_lots')
        .select('*, production_orders(order_code, customer_name)')
        .eq('lot_code', lotCode)
        .maybeSingle();

      if (!error && data) {
        setOrderNumber(data.production_orders?.order_code || '');
        setCustomerName(data.production_orders?.customer_name || '');
        
        // Puxa o primeiro item deste lote para preencher produto se houver
        const { data: items } = await supabase
          .from('production_lot_items')
          .select('*')
          .eq('lot_id', data.id)
          .limit(1);
        
        if (items && items[0]) {
          setProductCode(items[0].product_code || '');
          setProductName(items[0].product_name || 'Não informado');
          setProcessStep(items[0].current_step || cell || 'APONTAMENTO_MANUAL');
        }
      }
    }

    const timer = setTimeout(fetchLotInfo, 400); // Debounce
    return () => clearTimeout(timer);
  }, [lotCode]);

  const handleAdjustProduced = (val) => {
    const curr = parseInt(produced) || 0;
    setProduced(String(Math.max(0, curr + val)));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!onSubmit) return;

    onSubmit({
      date,
      shift,
      cell,
      hour,
      hours: Number(hours) || 8,
      produced: Number(produced) || 0,
      target: Number(target) || 0,
      scrap: Number(scrap) || 0,
      downtime: Number(downtime) || 0,
      notes: notes.trim(),
      operator: operator.trim() || user.name || user.email || 'Operador Manual',
      order_number: orderNumber.trim() || 'MANUAL',
      lot_code: lotCode.trim() || 'SEM_LOTE',
      product_code: productCode.trim(),
      product_name: productName.trim() || 'Não informado',
      customer_name: customerName.trim() || 'Não informado',
      process_step: processStep.trim() || cell || 'APONTAMENTO_MANUAL',
      station_name: stationName.trim(),
      entry_mode: 'manual',
      source: 'manual_entry',
      _duplicateAction: duplicateAction
    });

    // Resetar campos produzidos
    setProduced('0');
    setScrap('0');
    setDowntime('0');
    setNotes('');
  };

  const hasLimitedTraceability = !lotCode || lotCode === 'SEM_LOTE' || !orderNumber || orderNumber === 'MANUAL';

  return (
    <Card className="border-border/60 shadow-sm bg-card">
      <CardContent className="p-5 sm:p-6">
        
        {/* Alerta de rastreabilidade limitada */}
        {hasLimitedTraceability && (
          <div className="flex items-center gap-2 mb-5 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Apontamento sem lote/OP. Registro válido, porém com rastreabilidade limitada.</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          
          {/* Grid 1: Informações Básicas */}
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2.5">1. Contexto Operacional</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              
              <div className="space-y-1.5">
                <Label htmlFor="complete-date" className="text-xs font-semibold text-muted-foreground">Data</Label>
                <Input
                  id="complete-date"
                  type="date"
                  value={date}
                  onChange={(e) => { setDate(e.target.value); setDateEdited(true); }}
                  className="text-foreground bg-transparent font-medium [color-scheme:light] dark:[color-scheme:dark]"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="complete-shift" className="text-xs font-semibold text-muted-foreground">Turno</Label>
                <select
                  id="complete-shift"
                  value={shift}
                  onChange={(e) => { setShift(e.target.value); setShiftEdited(true); }}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none"
                  required
                >
                  <option value="1º Turno">1º Turno</option>
                  <option value="2º Turno">2º Turno</option>
                  <option value="3º Turno">3º Turno</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="complete-cell" className="text-xs font-semibold text-muted-foreground">Célula</Label>
                <select
                  id="complete-cell"
                  value={cell}
                  onChange={(e) => setCell(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none"
                  required
                >
                  <option value="">Selecione</option>
                  {activeCells.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="complete-hour" className="text-xs font-semibold text-muted-foreground">Hora</Label>
                <select
                  id="complete-hour"
                  value={hour}
                  onChange={(e) => { setHour(e.target.value); setHourEdited(true); }}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none"
                  required
                >
                  {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>

            </div>
          </div>

          {/* Grid 2: Rastreabilidade (MES) */}
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1"><Sparkles className="w-3.5 h-3.5 text-[#2d9c4a]" /> 2. Rastreabilidade (OP / Lote / Produto)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              
              <div className="space-y-1.5">
                <Label htmlFor="complete-lot" className="text-xs font-semibold text-muted-foreground">Lote Produtivo (Opcional)</Label>
                <Input
                  id="complete-lot"
                  placeholder="Ex: LOTE-TEST-4A8F"
                  value={lotCode}
                  onChange={(e) => setLotCode(e.target.value)}
                  className="h-10 text-sm font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="complete-op" className="text-xs font-semibold text-muted-foreground">Ordem de Produção (OP / Opcional)</Label>
                <Input
                  id="complete-op"
                  placeholder="Ex: ORDEM-TEST-4A8F"
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  className="h-10 text-sm font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="complete-step" className="text-xs font-semibold text-muted-foreground">Etapa / Processo</Label>
                <Input
                  id="complete-step"
                  placeholder="Ex: Corte, Bordo, Usinagem"
                  value={processStep}
                  onChange={(e) => setProcessStep(e.target.value)}
                  className="h-10 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="complete-prod-code" className="text-xs font-semibold text-muted-foreground">Código do Produto (Opcional)</Label>
                <Input
                  id="complete-prod-code"
                  placeholder="Código do produto"
                  value={productCode}
                  onChange={(e) => setProductCode(e.target.value)}
                  className="h-10 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="complete-prod-name" className="text-xs font-semibold text-muted-foreground">Descrição do Produto (Opcional)</Label>
                <Input
                  id="complete-prod-name"
                  placeholder="Ex: Painel MDF 18mm"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  className="h-10 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="complete-customer" className="text-xs font-semibold text-muted-foreground">Cliente (Opcional)</Label>
                <Input
                  id="complete-customer"
                  placeholder="Nome do cliente"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="h-10 text-sm"
                />
              </div>

              <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                <Label htmlFor="complete-station" className="text-xs font-semibold text-muted-foreground">Estação / Posto de Trabalho</Label>
                <Input
                  id="complete-station"
                  placeholder="Ex: Seccionadora A"
                  value={stationName}
                  onChange={(e) => setStationName(e.target.value)}
                  className="h-10 text-sm"
                />
              </div>

            </div>
          </div>

          {/* Campo Principal: Produzido com botões de atalho */}
          <div className="rounded-2xl border-2 border-[#2d9c4a] bg-gradient-to-br from-[#76FB91]/10 via-[#76FB91]/4 to-transparent p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center gap-5">
              <div className="flex items-center gap-3 shrink-0">
                <div className="w-12 h-12 rounded-xl bg-[#2d9c4a] flex items-center justify-center shadow-lg shadow-emerald-700/25">
                  <Factory className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground leading-tight">Quantidade Produzida</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">Total de peças boas da hora</p>
                </div>
              </div>

              <div className="flex-1 flex items-center gap-3">
                <input
                  type="number"
                  value={produced}
                  onChange={(e) => setProduced(e.target.value)}
                  placeholder="0"
                  required
                  min="0"
                  inputMode="numeric"
                  id="complete-produced"
                  className="w-full text-center text-5xl font-black tracking-tight text-[#2d9c4a] placeholder:text-[#2d9c4a]/30 bg-background/80 border-2 border-border rounded-xl py-3.5 focus:outline-none focus:ring-4 focus:ring-[#2d9c4a]/25"
                />
              </div>
            </div>

            {/* Atalhos Rápidos */}
            <div className="flex flex-wrap gap-2 justify-center mt-4 pt-3.5 border-t border-border/60">
              {[-10, -5, -1, 1, 5, 10].map(val => (
                <Button
                  key={val}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleAdjustProduced(val)}
                  className="text-xs font-bold w-14 h-9"
                >
                  {val > 0 ? `+${val}` : val}
                </Button>
              ))}
            </div>
          </div>

          {/* Grid 3: Dados de Paradas, Metas e Refugos */}
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2.5">3. Produtividade & Perdas</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              
              <div className="space-y-1.5">
                <Label htmlFor="complete-shift-hours" className="text-xs font-semibold text-muted-foreground">Horas do Turno</Label>
                <Input
                  id="complete-shift-hours"
                  type="number"
                  step="0.5"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  placeholder="8"
                  className="h-10 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="complete-target" className="text-xs font-semibold text-muted-foreground">Meta / hora</Label>
                <Input
                  id="complete-target"
                  type="number"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="0"
                  className="h-10 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="complete-scrap" className="text-xs font-semibold text-muted-foreground">Refugos (Peças Ruins)</Label>
                <Input
                  id="complete-scrap"
                  type="number"
                  min="0"
                  value={scrap}
                  onChange={(e) => setScrap(e.target.value)}
                  placeholder="0"
                  className="h-10 text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="complete-downtime" className="text-xs font-semibold text-muted-foreground">Tempo de Parada (min)</Label>
                <Input
                  id="complete-downtime"
                  type="number"
                  min="0"
                  value={downtime}
                  onChange={(e) => setDowntime(e.target.value)}
                  placeholder="0"
                  className="h-10 text-sm"
                />
              </div>

            </div>
          </div>

          {/* Grid 4: Operador e Observações */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            
            <div className="space-y-1.5">
              <Label htmlFor="complete-operator" className="text-xs font-semibold text-muted-foreground">Operador</Label>
              <Input
                id="complete-operator"
                placeholder="Nome do operador"
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                className="h-10 text-sm"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="complete-notes" className="text-xs font-semibold text-muted-foreground">Observações</Label>
              <Textarea
                id="complete-notes"
                placeholder="Anotações gerais..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="text-sm resize-none rounded-md"
              />
            </div>

          </div>

          {/* Configuração de Duplicidade (Admin/Gestores) */}
          {canReplaceOrNew && (
            <div className="space-y-1.5 border-t border-border/60 pt-3">
              <Label htmlFor="complete-dup-action" className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Opção para Conflitos (Se duplicado)</Label>
              <select
                id="complete-dup-action"
                value={duplicateAction}
                onChange={(e) => setDuplicateAction(e.target.value)}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-xs focus:outline-none"
              >
                <option value="sum">Somar à quantidade existente</option>
                <option value="replace">Substituir valor anterior</option>
                <option value="new">Lançar como novo registro separado</option>
              </select>
            </div>
          )}

          {/* Botão Salvar */}
          <div className="flex justify-end pt-2">
            <Button 
              type="submit" 
              disabled={saving || !cell} 
              className="px-8 h-11 bg-[#2d9c4a] hover:bg-[#237d3a] text-white font-bold gap-2 text-sm shadow-md transition-all rounded-xl w-full sm:w-auto"
            >
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
              Registrar Apontamento Completo
            </Button>
          </div>

        </form>
      </CardContent>
    </Card>
  );
}
