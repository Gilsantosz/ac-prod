import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  ChartNoAxesCombined,
  CheckCircle2,
  Clock3,
  Layers3,
  Loader2,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import PageHeader from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { GeneralLotSummaryCard, StageProgressGrid } from '@/components/lot-tracking/LotTrackingCards';
import {
  fetchGeneralLotTracking,
  formatDuration,
  formatForecastDate,
  getConfidenceMeta,
  getForecastStatusMeta,
} from '@/lib/lotTrackingService';

function KpiCard({ label, value, helper, icon: Icon, tone = 'text-primary bg-primary/10' }) {
  return (
    <Card className="p-4 border-border/60">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-black text-foreground">{value}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{helper}</p>
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tone}`}><Icon className="w-5 h-5" /></div>
      </div>
    </Card>
  );
}

function ForecastTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-lg text-xs">
      <p className="font-bold text-foreground">{label}</p>
      <p className="mt-1 text-primary">Média: {payload[0]?.value} min/peça</p>
      <p className="text-amber-600">Faixa segura: {payload[1]?.value} min/peça</p>
    </div>
  );
}

export default function LotTrackingDashboard() {
  const [selectedBatchId, setSelectedBatchId] = useState('');

  const { data: tracking, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['lot-tracking-dashboard', 'overview'],
    queryFn: () => fetchGeneralLotTracking({ limit: 50 }),
    refetchInterval: 30_000,
  });

  const generalLots = tracking?.general_lots || [];

  useEffect(() => {
    if (!selectedBatchId && generalLots.length) setSelectedBatchId(generalLots[0].batch_id);
  }, [generalLots, selectedBatchId]);

  const { data: selectedTracking, isLoading: loadingDetails } = useQuery({
    queryKey: ['lot-tracking-dashboard', 'batch', selectedBatchId],
    queryFn: () => fetchGeneralLotTracking({ batchId: selectedBatchId, limit: 1 }),
    enabled: Boolean(selectedBatchId),
    refetchInterval: 30_000,
  });

  const selectedLot = selectedTracking?.general_lots?.[0]
    || generalLots.find((lot) => lot.batch_id === selectedBatchId)
    || null;

  const totals = useMemo(() => generalLots.reduce((result, lot) => ({
    pieces: result.pieces + Number(lot.total_pieces || 0),
    ready: result.ready + Number(lot.ready_for_separation_pieces || 0),
    attention: result.attention + (['attention', 'delayed'].includes(lot.forecast_status) ? 1 : 0),
  }), { pieces: 0, ready: 0, attention: 0 }), [generalLots]);

  const modelData = (tracking?.stage_models || []).map((model) => ({
    name: model.stage_label,
    media: Number(model.minutes_per_piece || 0),
    segura: Number(model.p80_minutes_per_piece || 0),
  }));

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1700px] mx-auto space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <PageHeader
          title="Acompanhamento e Previsão de Lotes"
          subtitle="Andamento dos lotes gerais e previsão adaptativa até ficarem prontos para a separação."
          icon={ChartNoAxesCombined}
        />
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="rounded-xl gap-2 border-border/60">
            <Link to="/integridade-lote"><ShieldCheck className="w-4 h-4" /> Abrir integridade</Link>
          </Button>
          <Button onClick={() => refetch()} variant="outline" className="rounded-xl gap-2 border-border/60">
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
        </div>
      </div>

      <Card className="border-primary/20 bg-primary/[0.035] p-4">
        <div className="flex gap-3">
          <CalendarClock className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-extrabold text-foreground">O prazo mostrado termina antes da embalagem</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              A previsão considera Corte, Borda, Usinagem e Marcenaria. Quando todas as etapas exigidas terminarem, o lote aparece como <strong className="text-foreground">pronto para separação</strong>. A Marcenaria possui ritmo próprio e aprende separadamente com as baixas manuais e futuras coletas.
            </p>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <Card className="flex justify-center py-20 border-border/60"><Loader2 className="w-8 h-8 animate-spin text-primary" /></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <KpiCard label="Lotes gerais ativos" value={generalLots.length} helper="Cargas do PCP acompanhadas" icon={Layers3} />
            <KpiCard label="Peças em acompanhamento" value={totals.pieces.toLocaleString('pt-BR')} helper="Somadas entre os lotes gerais" icon={ChartNoAxesCombined} tone="text-sky-600 bg-sky-500/10" />
            <KpiCard label="Prontas para separação" value={totals.ready.toLocaleString('pt-BR')} helper="Produção concluída, ainda não embalada" icon={PackageCheck} tone="text-emerald-600 bg-emerald-500/10" />
            <KpiCard label="Lotes que exigem atenção" value={totals.attention} helper="Bloqueio, retrabalho, reposição ou atraso" icon={AlertTriangle} tone="text-rose-600 bg-rose-500/10" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
            <Card className="xl:col-span-3 p-5 border-border/60 space-y-4">
              <div>
                <h2 className="text-sm font-extrabold text-foreground">Tempo aprendido por etapa</h2>
                <p className="text-xs text-muted-foreground mt-1">Mediana por peça e faixa conservadora dos últimos {tracking?.model_window_days || 90} dias.</p>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={modelData} margin={{ top: 10, right: 12, bottom: 0, left: -18 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/60" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} unit="m" />
                    <Tooltip content={<ForecastTooltip />} />
                    <Bar dataKey="media" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="segura" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="xl:col-span-2 p-5 border-border/60 space-y-4">
              <div>
                <h2 className="text-sm font-extrabold text-foreground">Qualidade da previsão</h2>
                <p className="text-xs text-muted-foreground mt-1">A confiança aumenta automaticamente com novas coletas aprovadas.</p>
              </div>
              <div className="space-y-3">
                {(tracking?.stage_models || []).map((model) => {
                  const confidence = getConfidenceMeta(model.confidence);
                  return (
                    <div key={model.stage_code} className="rounded-xl border border-border/60 p-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-extrabold text-foreground">{model.stage_label}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {model.sample_count || 0} leituras · {model.observed_days || 0} dias válidos
                        </p>
                      </div>
                      <Badge variant="outline" className={`text-[9px] ${confidence.className}`}>{confidence.label}</Badge>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <section className="space-y-3">
            <div>
              <h2 className="text-base font-extrabold text-foreground">Lotes gerais em produção</h2>
              <p className="text-xs text-muted-foreground">Clique no lote geral para abrir os lotes de clientes e o detalhamento das etapas.</p>
            </div>
            {generalLots.length === 0 ? (
              <Card className="p-10 border-dashed text-center text-sm text-muted-foreground">Nenhum lote geral ativo foi encontrado.</Card>
            ) : generalLots.map((lot) => (
              <GeneralLotSummaryCard
                key={lot.batch_id}
                lot={lot}
                selected={selectedBatchId === lot.batch_id}
                onSelect={(nextLot) => setSelectedBatchId(nextLot.batch_id)}
              />
            ))}
          </section>

          {selectedBatchId && (
            <Card className="p-5 border-border/60 space-y-5">
              {loadingDetails ? (
                <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
              ) : selectedLot && (
                <>
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Detalhamento do lote geral</p>
                      <h2 className="text-2xl font-black text-foreground">{selectedLot.general_lot_code}</h2>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="outline" className={getForecastStatusMeta(selectedLot.forecast_status).className}>
                        {getForecastStatusMeta(selectedLot.forecast_status).label}
                      </Badge>
                      <Badge variant="outline" className="gap-1"><Clock3 className="w-3.5 h-3.5" /> {formatDuration(selectedLot.estimated_remaining_minutes)}</Badge>
                      <Badge variant="outline" className="gap-1"><CalendarClock className="w-3.5 h-3.5" /> {formatForecastDate(selectedLot.predicted_ready_at)}</Badge>
                    </div>
                  </div>

                  <StageProgressGrid stages={selectedLot.stages} />

                  <div className="overflow-x-auto rounded-xl border border-border/60">
                    <table className="w-full text-xs">
                      <thead className="bg-secondary/40 text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3 text-left">Lote cliente</th>
                          <th className="px-4 py-3 text-left">Cliente</th>
                          <th className="px-4 py-3 text-right">Peças prontas</th>
                          <th className="px-4 py-3 text-right">Andamento</th>
                          <th className="px-4 py-3 text-left">Gargalo</th>
                          <th className="px-4 py-3 text-left">Previsão</th>
                          <th className="px-4 py-3 text-center">Situação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {(selectedLot.client_lots || []).map((lot) => {
                          const status = getForecastStatusMeta(lot.forecast_status);
                          return (
                            <tr key={lot.lot_id} className="hover:bg-secondary/20">
                              <td className="px-4 py-3 font-black text-foreground">{lot.lot_code}</td>
                              <td className="px-4 py-3 max-w-xs truncate" title={lot.customer_name}>{lot.customer_name}</td>
                              <td className="px-4 py-3 text-right font-bold">{lot.ready_for_separation_pieces}/{lot.total_pieces}</td>
                              <td className="px-4 py-3 text-right font-bold">{Number(lot.progress_percent || 0).toFixed(1)}%</td>
                              <td className="px-4 py-3">{lot.bottleneck_stage}</td>
                              <td className="px-4 py-3">{formatForecastDate(lot.predicted_ready_at)}</td>
                              <td className="px-4 py-3 text-center">
                                {lot.ready_for_separation ? (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" />
                                ) : (
                                  <Badge variant="outline" className={`text-[9px] ${status.className}`}>{status.label}</Badge>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

