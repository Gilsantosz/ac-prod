import GradientBarShape from '@/components/ui/GradientBarShape';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldAlert, BarChart3,
  RefreshCw, Layers,
  PieChart as PieIcon, Activity, Target, ClipboardList,
  CheckCircle2, AlertOctagon, Factory, TrendingDown, Loader2,
  Calendar, ChevronDown, SlidersHorizontal, ExternalLink, Info, Filter
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid, PieChart, Pie, Cell, LabelList
} from 'recharts';
import { useAuth } from '@/lib/AuthContext';
import { getQualityDashboardMetrics } from '@/lib/qualityService';
import ExportReportMenu from '@/components/reports/ExportReportMenu';
import { createQualityReportDefinition } from '@/lib/reports/qualityReportDefinition';
import QualityDefectCatalogTab from '@/components/quality/QualityDefectCatalogTab';
import NonconformitiesListTab from '@/components/quality/NonconformitiesListTab';
import QualityChartDetailsModal from '@/components/quality/QualityChartDetailsModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

const QUALITY_PERIOD_LABELS = {
  today: 'Hoje',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  month: 'Este mês',
};

const SIX_M_COLORS = {
  'Máquina': '#f59e0b',
  'Método': '#3b82f6',
  'Material': '#ef4444',
  'Mão de obra': '#8b5cf6',
  'Medição': '#06b6d4',
  'Meio ambiente': '#10b981'
};

function QualityKpiCard({ icon: Icon, label, value, helper, tone }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className={`absolute inset-x-0 top-0 h-1 ${tone}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-black tracking-tight text-foreground">{value}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{helper}</p>
        </div>
        <div className="rounded-xl bg-secondary/60 p-2.5 text-muted-foreground transition-colors group-hover:text-foreground">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export default function QualityPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('pareto'); // 'pareto' | 'ncs' | 'spc' | 'catalog'
  const [timeRange, setTimeRange] = useState('7d'); // '7d' | 'today' | '30d' | 'month'
  const [selectedCell, setSelectedCell] = useState('all');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [detailsModalState, setDetailsModalState] = useState({ open: false, chartType: null });

  const userPermissions = {
    manage_quality: user?.role === 'admin' || user?.role === 'manager' || user?.permissions?.manage_quality,
    close_quality_nonconformities: user?.role === 'admin' || user?.role === 'manager' || user?.permissions?.close_quality_nonconformities,
    admin: user?.role === 'admin'
  };

  const {
    data: metrics = {},
    error: metricsError,
    isError: metricsIsError,
    isFetching,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['quality-metrics', timeRange, selectedCell],
    queryFn: () => getQualityDashboardMetrics({
      period: timeRange,
      cellName: selectedCell !== 'all' ? selectedCell : null
    }),
    refetchInterval: 20_000,
    staleTime: 10_000,
    retry: 1,
  });

  const qualityReport = useMemo(() => createQualityReportDefinition({
    metrics,
    filters: {
      periodLabel: QUALITY_PERIOD_LABELS[timeRange],
      cell: selectedCell,
    },
    generatedBy: user?.name || user?.email || '',
  }), [metrics, selectedCell, timeRange, user?.email, user?.name]);

  const openChartDetails = (chartType) => {
    setDetailsModalState({ open: true, chartType });
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Cabeçalho Superior */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-foreground flex items-center gap-2 tracking-tight">
            Qualidade
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Seletor de Período */}
          <div className="relative">
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              aria-label="Selecionar período do dashboard"
              className="h-10 pl-9 pr-8 bg-card border border-border/70 rounded-xl text-xs font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/20 shadow-sm appearance-none cursor-pointer"
            >
              <option value="7d">Últimos 7 dias</option>
              <option value="today">Hoje</option>
              <option value="30d">Últimos 30 dias</option>
              <option value="month">Este Mês</option>
            </select>
            <Calendar className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <ChevronDown className="w-4 h-4 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Botão de Filtro */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilterModal(true)}
            className="h-10 w-10 p-0 rounded-xl border-border/70 text-foreground flex items-center justify-center shadow-sm"
            title="Filtros da Qualidade"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </Button>

          <ExportReportMenu
            report={qualityReport}
            disabled={isLoading || metricsIsError}
            className="h-10 rounded-xl border-border/70 text-xs font-bold"
          />

          {/* Atualizar */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-10 rounded-xl border-border/70 text-xs font-bold flex items-center gap-1.5 shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            {isFetching ? 'Atualizando...' : 'Atualizar'}
          </Button>
        </div>
      </div>

      {metricsIsError && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-rose-500/30 bg-rose-500/[0.04] p-5">
          <div className="flex items-start gap-3">
            <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <div>
              <p className="text-sm font-extrabold text-foreground">Falha ao atualizar os indicadores de Qualidade</p>
              <p className="mt-1 text-xs text-muted-foreground">{metricsError?.message || 'Não foi possível consultar os dados.'}</p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => refetch()} className="rounded-xl gap-2">
            <RefreshCw className="h-4 w-4" />
            Tentar novamente
          </Button>
        </div>
      )}

      {/* Cards Principais de Indicadores */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border/60 bg-card py-10 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          Consolidando indicadores de Qualidade...
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-3">
          <QualityKpiCard
            icon={Target}
            label="First Pass Yield"
            value={`${metrics.fpy ?? 100}%`}
            helper="Aprovadas na primeira passagem"
            tone="bg-emerald-500"
          />
          <QualityKpiCard
            icon={TrendingDown}
            label="Taxa de reprovação"
            value={`${metrics.rejectionRate ?? 0}%`}
            helper={`${metrics.rejectedReadings ?? 0} leituras reprovadas`}
            tone="bg-rose-500"
          />
          <QualityKpiCard
            icon={ShieldAlert}
            label="NCs abertas"
            value={(metrics.openNCs ?? 0).toLocaleString('pt-BR')}
            helper="Exigem contenção ou plano de ação"
            tone="bg-amber-500"
          />
          <QualityKpiCard
            icon={ClipboardList}
            label="Defeitos registrados"
            value={(metrics.totalDefects ?? 0).toLocaleString('pt-BR')}
            helper={`${metrics.totalNCs ?? 0} não conformidade(s)`}
            tone="bg-violet-500"
          />
          <QualityKpiCard
            icon={CheckCircle2}
            label="Taxa de encerramento"
            value={`${metrics.closureRate ?? 100}%`}
            helper={`${metrics.closedNCs ?? 0} NC(s) encerrada(s)`}
            tone="bg-sky-500"
          />
          <QualityKpiCard
            icon={AlertOctagon}
            label="Críticas em aberto"
            value={(metrics.criticalNCs ?? 0).toLocaleString('pt-BR')}
            helper={`Principal defeito: ${metrics.topDefect || '—'}`}
            tone="bg-red-600"
          />
        </div>
      )}

      {/* Navegação por Abas (Sub-header Pills) */}
      <div className="flex p-1 bg-secondary/50 rounded-2xl border border-border/40 text-xs font-bold overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('pareto')}
          className={`px-4 py-2.5 rounded-xl transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'pareto' ? 'bg-background shadow text-amber-600 dark:text-amber-400 font-extrabold' : 'text-muted-foreground hover:bg-background/40'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          Pareto de Defeitos & 6M
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('ncs')}
          className={`px-4 py-2.5 rounded-xl transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'ncs' ? 'bg-background shadow text-amber-600 dark:text-amber-400 font-extrabold' : 'text-muted-foreground hover:bg-background/40'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          Não Conformidades & 5W2H ({metrics.openNCs || 0})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('spc')}
          className={`px-4 py-2.5 rounded-xl transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'spc' ? 'bg-background shadow text-amber-600 dark:text-amber-400 font-extrabold' : 'text-muted-foreground hover:bg-background/40'
          }`}
        >
          <Activity className="w-4 h-4" />
          Controle Estatístico (Cartas p & u)
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('catalog')}
          className={`px-4 py-2.5 rounded-xl transition-colors flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'catalog' ? 'bg-background shadow text-amber-600 dark:text-amber-400 font-extrabold' : 'text-muted-foreground hover:bg-background/40'
          }`}
        >
          <Layers className="w-4 h-4" />
          Catálogo 6M
        </button>
      </div>

      {/* Conteúdo da Aba 1: PARETO DE DEFEITOS & 6M */}
      {activeTab === 'pareto' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Card 1: Gráfico de Pareto de Defeitos (80/20) */}
          <div className="lg:col-span-2 bg-card border border-border/60 rounded-2xl p-5 space-y-4 shadow-sm flex flex-col justify-between">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-amber-500" />
                  Gráfico de Pareto de Defeitos (80/20)
                  <span title="Barras representam contagem em ordem decrescente; linha vermelha indica percentual acumulado.">
                    <Info className="w-3.5 h-3.5 text-muted-foreground/70 cursor-pointer hover:text-foreground" />
                  </span>
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Barras representam a contagem de refugos em ordem decrescente; a linha vermelha representa o percentual acumulado.
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => openChartDetails('pareto')}
                className="h-8 px-3 rounded-lg border-border/70 text-xs font-bold flex items-center gap-1 shrink-0"
              >
                Ver detalhes
                <ExternalLink className="w-3 h-3 ml-0.5" />
              </Button>
            </div>

            {isLoading ? (
              <div className="h-72 flex items-center justify-center text-xs text-muted-foreground">Carregando dados de Pareto...</div>
            ) : !metrics.paretoData || metrics.paretoData.length === 0 ? (
              <div className="h-72 flex items-center justify-center text-xs text-muted-foreground">Sem dados de defeitos para exibição.</div>
            ) : (
              <div className="h-72 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={metrics.paretoData} margin={{ top: 20, right: 15, left: -20, bottom: 20 }}>
                    <defs>
                      <linearGradient id="paretoBarGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" />
                        <stop offset="100%" stopColor="#d97706" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="defect" tick={{ fontSize: 11 }} interval={0} angle={-10} textAnchor="end" />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} label={{ value: 'Quantidade de Ocorrências', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                    <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} label={{ value: '% Acumulado', angle: 90, position: 'insideRight', fontSize: 10 }} />
                    <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '12px' }} />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <Bar shape={<GradientBarShape />} yAxisId="left" dataKey="count" name="Quantidade de Ocorrências" fill="url(#paretoBarGrad)" radius={[6, 6, 0, 0]}>
                      <LabelList dataKey="count" position="top" style={{ fontSize: '11px', fontWeight: 'bold', fill: '#d97706' }} />
                    </Bar>
                    <Line yAxisId="right" type="monotone" dataKey="cumulativePercentage" name="% Acumulado" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 5, fill: '#ef4444' }}>
                      <LabelList dataKey="cumulativePercentage" position="top" formatter={(val) => `${val}%`} style={{ fontSize: '11px', fontWeight: 'bold', fill: '#ef4444' }} />
                    </Line>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Card 2: Categorias Ishikawa (6M) */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-4 shadow-sm flex flex-col justify-between">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <PieIcon className="w-5 h-5 text-indigo-500" />
                  Categorias Ishikawa (6M)
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Distribuição das causas de refugos entre os 6M industriais.
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => openChartDetails('ishikawa')}
                className="h-8 px-3 rounded-lg border-border/70 text-xs font-bold flex items-center gap-1 shrink-0"
              >
                Ver detalhes
                <ExternalLink className="w-3 h-3 ml-0.5" />
              </Button>
            </div>

            <div className="relative h-64 w-full flex items-center justify-center">
              {metrics.sixMData && metrics.sixMData.some((item) => item.value > 0) ? (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={metrics.sixMData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {metrics.sixMData.map((entry) => (
                          <Cell key={entry.name} fill={SIX_M_COLORS[entry.name] || '#64748b'} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '12px' }} />
                    </PieChart>
                  </ResponsiveContainer>

                  {/* Texto Central do Donut */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-base font-black text-foreground">6M</span>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Total</span>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Sem dados suficientes.</p>
              )}
            </div>

            {/* Legenda Customizada das Categorias 6M abaixo do Gráfico */}
            {metrics.sixMData && metrics.sixMData.some((item) => item.value > 0) && (
              <div className="flex flex-wrap items-center justify-center gap-3 pt-1 border-t border-border/40">
                {metrics.sixMData.map((entry) => {
                  const total = metrics.sixMData.reduce((acc, curr) => acc + curr.value, 0);
                  const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0;
                  return (
                    <div key={entry.name} className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                      <span className="h-3 w-3 rounded-sm shrink-0" style={{ backgroundColor: SIX_M_COLORS[entry.name] || '#3b82f6' }} />
                      <span>{entry.name} ({pct}%)</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="lg:col-span-3 grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* Card 3: Tendência diária da Qualidade */}
            <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-4 shadow-sm flex flex-col justify-between">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                    <Activity className="w-5 h-5 text-sky-500" />
                    Tendência diária da Qualidade
                    <span title="Reprovações registradas e taxa diária de refugo sobre amostragem produtiva.">
                      <Info className="w-3.5 h-3.5 text-muted-foreground/70 cursor-pointer hover:text-foreground" />
                    </span>
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Reprovações registradas e taxa diária sobre leituras produtivas válidas.
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openChartDetails('trend')}
                  className="h-8 px-3 rounded-lg border-border/70 text-xs font-bold flex items-center gap-1 shrink-0"
                >
                  Ver detalhes
                  <ExternalLink className="w-3 h-3 ml-0.5" />
                </Button>
              </div>

              <div className="h-64">
                {metrics.pChartData?.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={metrics.pChartData} margin={{ top: 10, right: 10, left: -20, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="quantity" tick={{ fontSize: 10 }} allowDecimals={false} label={{ value: 'Reprovações', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#ef4444' }} />
                      <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} label={{ value: 'Taxa de reprovação (%)', angle: 90, position: 'insideRight', fontSize: 10, fill: '#0ea5e9' }} />
                      <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '12px' }} />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Bar shape={<GradientBarShape />} yAxisId="quantity" dataKey="rejected" name="Reprovadas" fill="#ef4444" radius={[5, 5, 0, 0]} />
                      <Line yAxisId="rate" type="monotone" dataKey="rejectionRate" name="Taxa de reprovação (%)" stroke="#0ea5e9" strokeWidth={3} dot={{ r: 4 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Sem histórico diário suficiente.</div>
                )}
              </div>
            </div>

            {/* Card 4: Defeitos por célula produtiva */}
            <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-4 shadow-sm flex flex-col justify-between">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                    <Factory className="w-5 h-5 text-violet-500" />
                    Defeitos por célula produtiva
                    <span title="Quantidade de defeitos atribuída à célula ou posto de detecção.">
                      <Info className="w-3.5 h-3.5 text-muted-foreground/70 cursor-pointer hover:text-foreground" />
                    </span>
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Quantidade não conforme atribuída ao ponto de detecção.
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openChartDetails('byCell')}
                  className="h-8 px-3 rounded-lg border-border/70 text-xs font-bold flex items-center gap-1 shrink-0"
                >
                  Ver detalhes
                  <ExternalLink className="w-3 h-3 ml-0.5" />
                </Button>
              </div>

              <div className="h-64">
                {metrics.byCellData?.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart layout="vertical" data={metrics.byCellData} margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} label={{ value: 'Quantidade de defeitos', position: 'insideBottom', offset: -5, fontSize: 10 }} />
                      <YAxis type="category" dataKey="cell" width={90} tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '12px' }} />
                      <Bar shape={<GradientBarShape horizontal />} dataKey="defects" name="Defeitos" fill="#8b5cf6" radius={[0, 6, 6, 0]}>
                        <LabelList dataKey="defects" position="right" style={{ fontSize: '11px', fontWeight: 'bold', fill: '#7c3aed' }} />
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Sem defeitos vinculados às células.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Conteúdo da Aba 2: NÃO CONFORMIDADES & 5W2H */}
      {activeTab === 'ncs' && (
        <NonconformitiesListTab userPermissions={userPermissions} />
      )}

      {/* Conteúdo da Aba 3: CONTROLE ESTATÍSTICO DE PROCESSO (SPC) */}
      {activeTab === 'spc' && (
        <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-4 shadow-sm">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <Activity className="w-5 h-5 text-emerald-500" />
              Carta de Controle $p$ (Proporção de Unidades Não Conformes)
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Limites Superior (UCL) e Inferior (LCL) de controle estatístico calculados rigorosamente sobre a amostragem.
            </p>
          </div>

          <div className="h-72 w-full pt-2">
            {metrics.pChartData && metrics.pChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={metrics.pChartData} margin={{ top: 10, right: 10, left: -20, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={[0, 'auto']} />
                  <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '12px' }} />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Line type="monotone" dataKey="p" name="Proporção Rejeitada (p)" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="pBar" name="Média (p-bar)" stroke="#3b82f6" strokeDasharray="5 5" dot={false} />
                  <Line type="monotone" dataKey="ucl" name="UCL (Limite Sup.)" stroke="#ef4444" strokeDasharray="3 3" dot={false} />
                  <Line type="monotone" dataKey="lcl" name="LCL (Limite Inf.)" stroke="#10b981" strokeDasharray="3 3" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                Dados insuficientes para gerar a carta estatística no período selecionado.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Conteúdo da Aba 4: CATÁLOGO 6M */}
      {activeTab === 'catalog' && (
        <QualityDefectCatalogTab userPermissions={userPermissions} />
      )}

      {/* Modal Interativo de Detalhes dos Gráficos */}
      <QualityChartDetailsModal
        open={detailsModalState.open}
        onOpenChange={(isOpen) => setDetailsModalState((prev) => ({ ...prev, open: isOpen }))}
        chartType={detailsModalState.chartType}
        metrics={metrics}
        report={qualityReport}
      />

      {/* Modal de Filtro Avançado */}
      <Dialog open={showFilterModal} onOpenChange={setShowFilterModal}>
        <DialogContent className="max-w-md rounded-3xl p-6 border-border bg-card shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-black text-foreground flex items-center gap-2">
              <Filter className="w-5 h-5 text-amber-500" />
              Filtros da Qualidade MES
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Filtre os indicadores por célula de produção e horizonte temporal.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4 text-xs font-bold">
            <div className="space-y-1.5">
              <label className="text-muted-foreground">Período de Análise</label>
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
                className="w-full h-10 px-3 bg-muted/40 border border-border/60 rounded-xl text-xs font-medium text-foreground focus:outline-none"
              >
                <option value="7d">Últimos 7 dias</option>
                <option value="today">Hoje (últimas 24h)</option>
                <option value="30d">Últimos 30 dias</option>
                <option value="month">Este Mês Atual</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-muted-foreground">Célula Produtiva / Ponto de Detecção</label>
              <select
                value={selectedCell}
                onChange={(e) => setSelectedCell(e.target.value)}
                className="w-full h-10 px-3 bg-muted/40 border border-border/60 rounded-xl text-xs font-medium text-foreground focus:outline-none"
              >
                <option value="all">Todas as Células / Fatos Geradores</option>
                <option value="Corte">Corte / Seccionadora</option>
                <option value="Borda">Coladeira de Borda</option>
                <option value="Usinagem">Centro de Usinagem CNC</option>
                <option value="Marcenaria">Marcenaria / Montagem</option>
                <option value="Embalagem">Embalagem & Expedição</option>
              </select>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setTimeRange('7d');
                setSelectedCell('all');
                setShowFilterModal(false);
              }}
              className="rounded-xl text-xs font-bold"
            >
              Resetar Filtros
            </Button>

            <Button
              size="sm"
              onClick={() => setShowFilterModal(false)}
              className="rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white"
            >
              Aplicar Filtros
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
