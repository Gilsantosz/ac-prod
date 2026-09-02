import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Pause, Play, Square } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/PageHeader';

const DEFAULTS = {
  devices: 8,
  operators: 14,
  pieces: 500,
  events: 3500,
  rate_per_second: 8,
  duration_minutes: 10,
  duplicate_percent: 5,
  rejection_percent: 1,
  replacement_percent: 1,
  network_oscillation: false,
};

function newRunId() {
  const date = new Date();
  const stamp = date.toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  const short = (crypto.randomUUID?.() || Math.random().toString(36)).replace(/-/g, '').slice(0, 8).toUpperCase();
  return `CAPTEST_${stamp}_${short}`;
}

export default function CapacityTests() {
  const [config, setConfig] = useState(DEFAULTS);
  const [confirmation, setConfirmation] = useState('');
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
  const setNumber = (key, value) => setConfig((current) => ({ ...current, [key]: Number(value) }));

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

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Testes de Capacidade" subtitle="Plano de controle protegido para ensaios CAPTEST auditáveis" icon={Activity} />

      <section className="grid gap-4 rounded-2xl border border-border bg-card p-5 md:grid-cols-4">
        {Object.entries({ devices: 'Dispositivos', operators: 'Operadores', pieces: 'Peças', events: 'Eventos', rate_per_second: 'Eventos/s', duration_minutes: 'Duração (min)', duplicate_percent: '% duplicadas', rejection_percent: '% reprovação', replacement_percent: '% reposição' }).map(([key, label]) => (
          <label key={key} className="space-y-1 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <input className="w-full rounded-lg border bg-background px-3 py-2" type="number" min="0" value={config[key]} onChange={(event) => setNumber(key, event.target.value)} />
          </label>
        ))}
        <label className="flex items-center gap-2 self-end rounded-lg border px-3 py-2 text-sm">
          <input type="checkbox" checked={config.network_oscillation} onChange={(event) => setConfig((current) => ({ ...current, network_oscillation: event.target.checked }))} />
          Oscilação de rede
        </label>
      </section>

      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4" /> Confirmação obrigatória</div>
        <p className="mt-1 text-xs text-muted-foreground">Digite INICIAR TESTE CONTROLADO. O pedido não executa carga no navegador: um script versionado assume o run com limites e parada de emergência.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          <Button onClick={start} disabled={confirmation !== 'INICIAR TESTE CONTROLADO'}><Play className="mr-2 h-4 w-4" />Iniciar</Button>
          <Button variant="outline" onClick={() => control('pause')} disabled={!activeRunId}><Pause className="mr-2 h-4 w-4" />Pausar</Button>
          <Button variant="destructive" onClick={() => control('emergency_stop')} disabled={!activeRunId}><Square className="mr-2 h-4 w-4" />Parada de emergência</Button>
        </div>
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
      </section>
    </div>
  );
}

function Metric({ label, value }) {
  return <div className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>;
}
