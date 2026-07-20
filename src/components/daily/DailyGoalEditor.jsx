import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Copy, Save, Upload, CheckCircle2, Loader2, Lock } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useOperatorSession } from '@/hooks/useOperatorSession';
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
  const { isLoggedIn: isOperatorLoggedIn } = useOperatorSession();
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

  // Permissão de alteração: APENAS perfis de Supervisor, Gestor (manager) ou Admin
  const userRole = String(user?.role || '').toLowerCase();
  const canEditGoals = !isOperatorLoggedIn && (
    ['admin', 'manager', 'gestor', 'supervisor'].includes(userRole) ||
    Boolean(user?.permissions?.manage_cells) ||
    Boolean(user?.permissions?.manage_goals)
  );

  const selectedUnit = unit || inferred.unit;

  // Sincroniza unidade ao trocar célula (antes de buscar no banco)
  useEffect(() => {
    setUnit(inferred.unit);
    setCapacity('');
    setTarget('');
    setExistingGoalId(null);
  }, [cellName, inferred.unit]);

  /* ── Auto-fill ao mudar data / turno / célula ──────────── */
  const loadExistingGoal = useCallback(async () => {
    const finalCell = clean(cellName);
    if (!finalCell || !date || !shift) return;

    setLoadingGoal(true);
    try {
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
    if (!canEditGoals) {
      toast.warning('Acesso Restrito: Apenas perfis de Gestor e Supervisor têm permissão para cadastrar ou alterar metas de produção.');
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
      toast.success(existingGoalId ? 'Meta atualizada com sucesso.' : 'Meta diária salva com sucesso.');
      onSaved?.();
      await loadExistingGoal();
    } catch (error) {
      if (/row-level security policy|permission denied/i.test(error.message || '')) {
        toast.error('Acesso Restrito: Seu perfil de usuário não possui permissão no banco de dados para alterar metas.');
      } else {
        toast.error(`Não foi possível salvar a meta: ${error.message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  /* ── Duplicar dia anterior ─────────────────────────────── */
  const duplicatePreviousDay = async () => {
    if (!canEditGoals) {
      toast.warning('Acesso Restrito: Apenas perfis de Gestor e Supervisor têm permissão para cadastrar ou alterar metas de produção.');
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
        toast.error('Acesso Restrito: Seu perfil de usuário não possui permissão para alterar metas.');
      } else {
        toast.error(`Falha ao duplicar metas: ${error.message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  /* ── Importar planilha ─────────────────────────────────── */
  const importGoals = async (event) => {
    if (!canEditGoals) {
      toast.warning('Acesso Restrito: Apenas perfis de Gestor e Supervisor têm permissão para cadastrar ou alterar metas de produção.');
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
        toast.error('Acesso Restrito: Seu perfil de usuário não possui permissão para alterar metas.');
      } else {
        toast.error(`Falha ao importar metas: ${error.message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const isEditing = !!existingGoalId;

  return (
    <Card className="border-border/60 shadow-sm bg-card rounded-2xl overflow-hidden">
      <CardHeader className="pb-3 border-b border-border/40">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base font-bold text-foreground">Metas por célula e unidade</CardTitle>
          
          {loadingGoal && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /> Carregando meta…
            </span>
          )}

          {!loadingGoal && !canEditGoals && (
            <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-semibold bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-800/60">
              <Lock className="w-3.5 h-3.5" /> Somente Leitura — Alteração restrita a Supervisores e Gestores
            </span>
          )}

          {!loadingGoal && canEditGoals && isEditing && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800/60">
              <CheckCircle2 className="w-3.5 h-3.5" /> Meta cadastrada — editando
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-4 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <div className="space-y-1.5">
          <Label className="text-xs font-bold text-foreground">Turno</Label>
          <Select value={shift} onValueChange={setShift} disabled={!canEditGoals}>
            <SelectTrigger className="rounded-xl h-10 border-border/70 text-xs font-semibold bg-background/60"><SelectValue /></SelectTrigger>
            <SelectContent className="rounded-xl">{SHIFTS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <Label className="text-xs font-bold text-foreground">Célula</Label>
          <Select value={cellName} onValueChange={(value) => { setCellName(value); }} disabled={!canEditGoals}>
            <SelectTrigger className="rounded-xl h-10 border-border/70 text-xs font-semibold bg-background/60"><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent className="rounded-xl">
              {activeCells.map((cell) => <SelectItem key={cell.id || cell.name} value={cell.name}>{cell.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-bold text-foreground">Unidade</Label>
          <Select value={selectedUnit} onValueChange={setUnit} disabled={!canEditGoals}>
            <SelectTrigger className="rounded-xl h-10 border-border/70 text-xs font-semibold bg-background/60"><SelectValue /></SelectTrigger>
            <SelectContent className="rounded-xl">{UNITS.map((item) => <SelectItem key={item} value={item}>{getUnitLabel(item)}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-bold text-foreground">Capacidade</Label>
          <Input
            type="number"
            min="0"
            disabled={!canEditGoals}
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            placeholder="0"
            className={`rounded-xl h-10 text-xs font-semibold ${isEditing ? 'border-emerald-500/50 bg-emerald-500/5' : ''}`}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-bold text-foreground">Meta</Label>
          <Input
            type="number"
            min="0"
            disabled={!canEditGoals}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder="0"
            className={`rounded-xl h-10 text-xs font-semibold ${isEditing ? 'border-emerald-500/50 bg-emerald-500/5' : ''}`}
          />
        </div>

        <div className="md:col-span-6 flex flex-wrap gap-2 pt-2">
          <Button
            onClick={saveGoal}
            disabled={!canEditGoals || saving || loadingGoal}
            title={!canEditGoals ? 'Apenas perfis de Gestor e Supervisor podem alterar metas' : ''}
            className="gap-2 bg-[#1A2238] hover:bg-[#111728] text-white font-bold rounded-xl h-10 px-5 shadow-sm text-xs"
          >
            <Save className="w-4 h-4" /> {isEditing ? 'Atualizar meta' : 'Salvar meta'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={duplicatePreviousDay}
            disabled={!canEditGoals || saving || loadingGoal}
            title={!canEditGoals ? 'Apenas perfis de Gestor e Supervisor podem alterar metas' : ''}
            className="gap-2 rounded-xl h-10 text-xs font-semibold border-border/80 bg-card hover:bg-secondary/50"
          >
            <Copy className="w-4 h-4" /> Duplicar dia anterior
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={!canEditGoals || saving || loadingGoal}
            title={!canEditGoals ? 'Apenas perfis de Gestor e Supervisor podem alterar metas' : ''}
            className="gap-2 rounded-xl h-10 text-xs font-semibold border-border/80 bg-card hover:bg-secondary/50"
          >
            <Upload className="w-4 h-4" /> Importar planilha
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={importGoals} disabled={!canEditGoals} />
        </div>
      </CardContent>
    </Card>
  );
}
