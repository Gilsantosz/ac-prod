import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Pause, Play, RotateCcw, Square } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/PageHeader';
import {
  CAPACITY_PROFILE_REQUIREMENTS,
  CONTROLLABLE_CAPACITY_STATUSES,
  isCapacityExecutorHeartbeatStale,
  selectControllableCapacityRun,
} from '@/lib/capacityTestControl';

const DEFAULTS = {
  ...CAPACITY_PROFILE_REQUIREMENTS.smoke,
  operators: 14,
  profile: 'smoke',
  target: 'staging',
  sequence_base: 180000000,
};

const CAPACITY_PROFILES = Object.keys(CAPACITY_PROFILE_REQUIREMENTS);

function newRunId() {
  const date = new Date();
  const stamp = date.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  const short = (crypto.randomUUID?.() || Math.random().toString(36)).replace(/-/g, '').slice(0, 8).toUpperCase();
  return `CAPTEST_${stamp}_${short}`;
}

export default function CapacityTests() {
  const [config, setConfig] = useState(DEFAULTS);
  const [confirmation, setConfirmation] = useState('');
  const [staleConfirmation, setStaleConfirmation] = useState('');
  const [activeRunId, setActiveRunId] = useState(null);
  const [message, setMessage] = useState(null);

  const health = useQuery({
    queryKey: ['capacity-runtime-health'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_collection_runtime_health_v3');
      if (error) throw error;
      return data;
    },
    refetchInterval: 2_000,
  });

  const runs = useQuery({
    queryKey: ['capacity-test-runs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('capacity_test_runs').select('*').order('created_at', { ascending: false }).limit(10);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 2_000,
  });

  const active = useMemo(() => runs.data?.find((run) => run.run_id === activeRunId), [activeRunId, runs.data]);
  const executorStale = isCapacityExecutorHeartbeatStale(active);
  const setNumber = (key, value) => setConfig((current) => ({ ...current, [key]: Number(value) }));
  const setProfile = (profile) => setConfig((current) => ({
    ...current,
    profile,
    ...CAPACITY_PROFILE_REQUIREMENTS[profile],
  }));

  useEffect(() => {
    if (!runs.data) return;
    const selected = selectControllableCapacityRun(runs.data, activeRunId);
    const nextRunId = selected?.run_id || null;
    if (nextRunId !== activeRunId) setActiveRunId(nextRunId);
  }, [activeRunId, runs.data]);

  const start = async () => {
    setMessage(null);
    const runId = newRunId();
    const payload = { ...config, app_version: import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_COMMIT_SHA || 'development' };
    const { error } = await supabase.rpc('request_capacity_test_run', {
      p_run_id: runId,
      p_config: payload,
      p_confirmation: confirmation,
    });
    if (error) { setMessage(error.message); return; }
    setActiveRunId(runId);
    setConfirmation('');
    setMessage(`Run ${runId} solicitado. O executor auditável deve assumir o run antes de gerar carga.`);
    await runs.refetch();
  };

  const control = async (action) => {
    if (!activeRunId) return;
    const { error } = await supabase.rpc('control_capacity_test_run', { p_run_id: activeRunId, p_action: action });
    setMessage(error ? error.message : `Ação ${action} registrada.`);
    await runs.refetch();
  };

  const failStaleExecutor = async () => {
    if (!activeRunId || !executorStale) return;
    const { error } = await supabase.rpc('fail_stale_capacity_test_run_v3', {
      p_run_id: activeRunId,
      p_confirmation: staleConfirmation,
    });
    setMessage(error
      ? error.message
      : `Run ${activeRunId} marcado como failed por heartbeat vencido. Use um novo run e uma nova faixa de sequência.`);
    if (!error) setStaleConfirmation('');
    await runs.refetch();
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Testes de Capacidade" subtitle="Plano de controle protegido para ensaios CAPTEST auditáveis" icon={Activity} />

      <section className="grid gap-4 rounded-2xl border border-border bg-card p-5 md:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Perfil k6</span>
          <select className="w-full rounded-lg border bg-background px-3 py-2" value={config.profile} onChange={(event) => setProfile(event.target.value)}>
            {CAPACITY_PROFILES.map((profile) => <option key={profile} value={profile}>{profile}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Alvo</span>
          <select className="w-full rounded-lg border bg-background px-3 py-2" value={config.target} onChange={(event) => setConfig((current) => ({ ...current, target: event.target.value }))}>
            <option value="staging">staging</option>
            <option value="test-production">test-production</option>
          </select>
        </label>
        {Object.entries({ sequence_base: 'Sequence base', devices: 'Dispositivos', operators: 'Operadores', pieces: 'Peças', duration_minutes: 'Duração (min)' }).map(([key, label]) => (
          <label key={key} className="space-y-1 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <input className="w-full rounded-lg border bg-background px-3 py-2 disabled:cursor-not-allowed disabled:opacity-60" type="number" min="0" value={config[key]} onChange={(event) => setNumber(key, event.target.value)} disabled={['devices', 'pieces', 'duration_minutes'].includes(key)} />
          </label>
        ))}
        <p className="self-end text-xs text-muted-foreground md:col-span-2">
          Dispositivos, peças e duração são fixos no perfil versionado; o executor recusa qualquer divergência do pedido auditado.
        </p>
      </section>

      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4" /> Confirmação obrigatória</div>
        <p className="mt-1 text-xs text-muted-foreground">Digite INICIAR TESTE CONTROLADO. O pedido não executa carga no navegador: um script versionado assume o run com limites e parada de emergência.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          <Button onClick={start} disabled={confirmation !== 'INICIAR TESTE CONTROLADO' || Boolean(active)}><Play className="mr-2 h-4 w-4" />Iniciar</Button>
          <Button variant="outline" onClick={() => control('pause')} disabled={active?.status !== 'running'}><Pause className="mr-2 h-4 w-4" />Pausar</Button>
          <Button variant="outline" onClick={() => control('resume')} disabled={active?.status !== 'paused'}><RotateCcw className="mr-2 h-4 w-4" />Retomar</Button>
          <Button variant="outline" onClick={() => control('cancel')} disabled={!CONTROLLABLE_CAPACITY_STATUSES.includes(active?.status)}><Square className="mr-2 h-4 w-4" />Cancelar</Button>
          <Button variant="destructive" onClick={() => control('emergency_stop')} disabled={!CONTROLLABLE_CAPACITY_STATUSES.includes(active?.status)}><AlertTriangle className="mr-2 h-4 w-4" />Parada de emergência</Button>
        </div>
        {executorStale && (
          <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm font-semibold text-destructive">Executor sem heartbeat há pelo menos 15 segundos</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Confirme primeiro que não existe processo k6 vivo nesse host. Este run será falhado e não poderá ser retomado; a próxima tentativa exige novo run e nova faixa.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2"
                value={staleConfirmation}
                onChange={(event) => setStaleConfirmation(event.target.value)}
                placeholder="FALHAR EXECUTOR SEM HEARTBEAT"
              />
              <Button
                variant="destructive"
                onClick={failStaleExecutor}
                disabled={staleConfirmation !== 'FALHAR EXECUTOR SEM HEARTBEAT'}
              >
                Falhar run órfão
              </Button>
            </div>
          </div>
        )}
        {activeRunId && <p className="mt-3 break-all font-mono text-xs">Run controlado: {activeRunId}</p>}
        {message && <p className="mt-3 text-sm">{message}</p>}
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        <Metric label="Status" value={active?.status || 'sem run ativo'} />
        <Metric label="Fila decision" value={health.data?.queues?.decision_length ?? '—'} />
        <Metric label="Fila projection" value={health.data?.queues?.projection_length ?? '—'} />
        <Metric label="Dead letters" value={health.data?.counts?.dlq_messages ?? '—'} />
        <Metric label="Decision p95" value={`${health.data?.latency_ms?.processing?.p95 ?? '—'} ms`} />
        <Metric label="Projection p95" value={`${health.data?.latency_ms?.projection?.p95 ?? '—'} ms`} />
        <Metric label="Worker decision" value={health.data?.workers?.active_decision ?? '—'} />
        <Metric label="Worker projection" value={health.data?.workers?.active_projection ?? '—'} />
        <Metric label="Heartbeat executor" value={active?.executor_heartbeat_at ? new Date(active.executor_heartbeat_at).toLocaleTimeString() : '—'} />
      </section>
    </div>
  );
}

function Metric({ label, value }) {
  return <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>;
}
