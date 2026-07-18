import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Copy, Save, Upload, CheckCircle2, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import {
  PRODUCTION_UNITS,
  getProductionMetricRule,
  getUnitLabel,
  normalizeProductionUnit,
} from '@/lib/productionUnitRules';

const SHIFTS = ['1º Turno', '2º Turno', '3º Turno'];
const UNITS = [
  PRODUCTION_UNITS.SHEETS,
  PRODUCTION_UNITS.METERS,
  PRODUCTION_UNITS.PIECES,
  PRODUCTION_UNITS.COVERS,
];

const clean = (value) => String(value ?? '').trim();
const number = (value) => Math.max(0, Number(String(value ?? '').replace(',', '.')) || 0);

function normalizeColumn(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function pick(row, aliases) {
  const entry = Object.entries(row).find(([key]) => aliases.includes(normalizeColumn(key)));
  return entry ? entry[1] : '';
}

export default function DailyGoalEditor({ date, activeCells = [], onSaved }) {
  const { user } = useAuth();
  const fileRef = useRef(null);
  const [shift, setShift] = useState(SHIFTS[0]);
  const [cellName, setCellName] = useState(activeCells[0]?.name || '');
  const inferred = useMemo(() => getProductionMetricRule({ cell: cellName }), [cellName]);
  const [unit, setUnit] = useState(inferred.unit);
  const [capacity, setCapacity] = useState('');
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingGoal, setLoadingGoal] = useState(false);
  const [existingGoalId, setExistingGoalId] = useState(null);

  const selectedUnit = unit || inferred.unit;

  // Sincroniza unidade ao trocar célula (antes de buscar no banco)
  useEffect(() => {
    setUnit(inferred.unit);
    setCapacity('');
    setTarget('');
    setExistingGoalId(null);
  }, [cellName]);   


  /* ── Auto-fill ao mudar data / turno / célula ──────────── */
  const loadExistingGoal = useCallback(async () => {
    const finalCell = clean(cellName);
    if (!finalCell || !date || !shift) return;

    setLoadingGoal(true);
    try {
      // Busca sem filtrar por metric_unit — a unidade correta vem do registro salvo
      const { data: rows, error } = await supabase
        .from('production_daily_goals')
        .select('*')
        .eq('date', date)
        .ilike('shift', shift)
        .ilike('cell_name', finalCell)
        .limit(1);

      if (error && !/does not exist/i.test(error.message)) throw error;

      const data = rows && rows.length > 0 ? rows[0] : null;

      if (data) {
        setExistingGoalId(data.id);
        setUnit(data.metric_unit || inferred.unit);
        setCapacity(data.capacity != null ? String(data.capacity) : '');
        setTarget(data.target != null ? String(data.target) : '');
      } else {
        setExistingGoalId(null);
        setCapacity('');
        setTarget('');
        // unidade ja foi sincronizada pelo useEffect de cellName
      }
    } catch (err) {
      console.warn('Falha ao carregar meta existente:', err.message);
    } finally {
      setLoadingGoal(false);
    }
  }, [date, shift, cellName, inferred.unit]);




  useEffect(() => {
    loadExistingGoal();
  }, [loadExistingGoal]);

  /* ── Salvar / Atualizar ────────────────────────────────── */
  const saveGoal = async () => {
    if (user?.role === 'operator') {
      toast.warning('Acesso Restrito: Seu perfil operacional não permite cadastrar ou alterar metas.');
      return;
    }
    const finalCell = clean(cellName);
    if (!finalCell) {
      toast.error('Selecione uma célula para salvar a meta.');
      return;
    }
    setSaving(true);
    try {
      const metricUnit = normalizeProductionUnit(selectedUnit);
      const metricRule = getProductionMetricRule({ cell: finalCell, metric_unit: metricUnit });
      const { error } = await supabase.from('production_daily_goals').upsert({
        date,
        shift,
        cell_name: finalCell,
        area_name: finalCell,
        metric_unit: metricUnit,
        metric_unit_label: getUnitLabel(metricUnit),
        metric_name: metricRule.metricName,
        capacity: number(capacity),
        target: number(target),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'date,shift,cell_name,metric_unit' });
      if (error) throw error;
      toast.success(existingGoalId ? 'Meta atualizada.' : 'Meta diária salva.');
      onSaved?.();
      await loadExistingGoal();
    } catch (error) {
      if (/row-level security policy|permission denied/i.test(error.message || '')) {
        toast.error('Acesso Restrito: Seu perfil operacional não tem permissão para cadastrar ou alterar metas no sistema.');
      } else {
        toast.error(`Não foi possível salvar a meta: ${error.message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  /* ── Duplicar dia anterior ─────────────────────────────── */
  const duplicatePreviousDay = async () => {
    if (user?.role === 'operator') {
      toast.warning('Acesso Restrito: Seu perfil operacional não permite cadastrar ou alterar metas.');
      return;
    }
    setSaving(true);
    try {
      const previous = new Date(`${date}T12:00:00`);
      previous.setDate(previous.getDate() - 1);
      const previousDate = previous.toISOString().slice(0, 10);
      const { data, error } = await supabase.from('production_daily_goals').select('*').eq('date', previousDate);
      if (error) throw error;
      const rows = (data || []).map(({ id, created_at, updated_at, ...row }) => ({
        ...row,
        date,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      if (!rows.length) {
        toast.info('O dia anterior não tem metas para duplicar.');
        return;
      }
      const { error: upsertError } = await supabase
        .from('production_daily_goals')
        .upsert(rows, { onConflict: 'date,shift,cell_name,metric_unit' });
      if (upsertError) throw upsertError;
      toast.success('Metas do dia anterior duplicadas.');
      onSaved?.();
      await loadExistingGoal();
    } catch (error) {
      if (/row-level security policy|permission denied/i.test(error.message || '')) {
        toast.error('Acesso Restrito: Seu perfil operacional não tem permissão para cadastrar ou alterar metas no sistema.');
      } else {
        toast.error(`Falha ao duplicar metas: ${error.message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  /* ── Importar planilha ─────────────────────────────────── */
  const importGoals = async (event) => {
    if (user?.role === 'operator') {
      toast.warning('Acesso Restrito: Seu perfil operacional não permite cadastrar ou alterar metas.');
      return;
    }
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setSaving(true);
    try {
      const bytes = await file.arrayBuffer();
      const workbook = XLSX.read(bytes, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const payload = rows.map((row) => {
        const cell = clean(pick(row, ['celula', 'célula', 'area', 'área', 'cell']));
        const metricUnit = normalizeProductionUnit(pick(row, ['unidade', 'unit', 'metric_unit']) || getProductionMetricRule({ cell }).unit);
        const metricRule = getProductionMetricRule({ cell, metric_unit: metricUnit });
        return {
          date: clean(pick(row, ['data', 'date'])) || date,
          shift: clean(pick(row, ['turno', 'shift'])) || shift,
          cell_name: cell,
          area_name: clean(pick(row, ['area', 'área'])) || cell,
          metric_unit: metricUnit,
          metric_unit_label: getUnitLabel(metricUnit),
          metric_name: metricRule.metricName,
          capacity: number(pick(row, ['capacidade', 'capac', 'capacity'])),
          target: number(pick(row, ['meta', 'target'])),
          updated_at: new Date().toISOString(),
        };
      }).filter((row) => row.cell_name);

      if (!payload.length) {
        toast.error('Não encontrei linhas de metas na planilha.');
        return;
      }
      const { error } = await supabase
        .from('production_daily_goals')
        .upsert(payload, { onConflict: 'date,shift,cell_name,metric_unit' });
      if (error) throw error;
      toast.success(`${payload.length} meta(s) importada(s).`);
      onSaved?.();
      await loadExistingGoal();
    } catch (error) {
      if (/row-level security policy|permission denied/i.test(error.message || '')) {
        toast.error('Acesso Restrito: Seu perfil operacional não tem permissão para cadastrar ou alterar metas no sistema.');
      } else {
        toast.error(`Falha ao importar metas: ${error.message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const isEditing = !!existingGoalId;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">Metas por célula e unidade</CardTitle>
          {loadingGoal && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando meta…
            </span>
          )}
          {!loadingGoal && isEditing && (
            <span className="flex items-center gap-1.5 text-xs text-[#2d9c4a] font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" /> Meta cadastrada — editando
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <div className="space-y-2">
          <Label>Turno</Label>
          <Select value={shift} onValueChange={setShift}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{SHIFTS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>Célula</Label>
          <Select value={cellName} onValueChange={(value) => { setCellName(value); }}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>
              {activeCells.map((cell) => <SelectItem key={cell.id || cell.name} value={cell.name}>{cell.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Unidade</Label>
          <Select value={selectedUnit} onValueChange={setUnit}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{UNITS.map((item) => <SelectItem key={item} value={item}>{getUnitLabel(item)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Capacidade</Label>
          <Input
            type="number"
            min="0"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            placeholder="0"
            className={isEditing ? 'border-[#2d9c4a]/50 bg-[#2d9c4a]/5' : ''}
          />
        </div>
        <div className="space-y-2">
          <Label>Meta</Label>
          <Input
            type="number"
            min="0"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder="0"
            className={isEditing ? 'border-[#2d9c4a]/50 bg-[#2d9c4a]/5' : ''}
          />
        </div>
        <div className="md:col-span-6 flex flex-wrap gap-2">
          <Button onClick={saveGoal} disabled={saving || loadingGoal} className="gap-2">
            <Save className="w-4 h-4" /> {isEditing ? 'Atualizar meta' : 'Salvar meta'}
          </Button>
          <Button type="button" variant="outline" onClick={duplicatePreviousDay} disabled={saving || loadingGoal} className="gap-2">
            <Copy className="w-4 h-4" /> Duplicar dia anterior
          </Button>
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={saving || loadingGoal} className="gap-2">
            <Upload className="w-4 h-4" /> Importar planilha
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={importGoals} />
        </div>
      </CardContent>
    </Card>
  );
}

