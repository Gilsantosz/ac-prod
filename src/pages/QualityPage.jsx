import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldAlert, BarChart3,
  Download, RefreshCw, Layers,
  PieChart as PieIcon, Activity, Target, ClipboardList,
  CheckCircle2, AlertOctagon, Factory, TrendingDown, Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  Tooltip, Legend, CartesianGrid, PieChart, Pie, Cell
} from 'recharts';
import { useAuth } from '@/lib/AuthContext';
import {
  getQualityDashboardMetrics,
  getNonconformities,
  exportNonconformitiesCSV
} from '@/lib/qualityService';
import QualityDefectCatalogTab from '@/components/quality/QualityDefectCatalogTab';
import NonconformitiesListTab from '@/components/quality/NonconformitiesListTab';
import { toast } from 'sonner';

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
    queryKey: ['quality-metrics'],
    queryFn: () => getQualityDashboardMetrics(),
    refetchInterval: 20_000,
    staleTime: 10_000,
    retry: 1,
  });

  const handleExportCSV = async () => {
    try {
      const data = await getNonconformities({ limit: 1000 });
      exportNonconformitiesCSV(data.nonconformities || []);
      toast.success('Relatório CSV exportado com sucesso!');
    } catch (error) {
      console.error('Erro ao exportar CSV:', error);
      toast.error('Falha ao exportar CSV de qualidade.');
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Cabeçalho */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-foreground flex items-center gap-2 tracking-tight">
            <ShieldAlert className="w-6 h-6 text-amber-500" />
            Módulo de Gestão da Qualidade MES
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Análise de Pareto de Defeitos 6M, FPY, Controle Estatístico de Processo e Ações 5W2H.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            className="h-10 rounded-xl border-border/60 text-xs font-bold flex items-center gap-1.5"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            Exportar CSV
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-10 rounded-xl border-border/60 text-xs font-bold flex items-center gap-1.5"
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

      {/* Navegação por Abas */}
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
          {/* Gráfico de Pareto de Defeitos */}
          <div className="lg:col-span-2 bg-card border border-border/60 rounded-2xl p-5 space-y-4 shadow-sm">
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-amber-500" />
                Gráfico de Pareto de Defeitos (80/20)
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Barras representam a contagem de refugos em ordem decrescente; a linha vermelha representa o percentual acumulado.
              </p>
            </div>

            {isLoading ? (
              <div className="h-64 flex items-center justify-center text-xs text-muted-foreground">Carregando dados de Pareto...</div>
            ) : !metrics.paretoData || metrics.paretoData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-xs text-muted-foreground">Sem dados de defeitos para exibição.</div>
            ) : (
              <div className="h-72 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={metrics.paretoData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="defect" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} label={{ value: 'Quantidade de Defeitos', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                    <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} label={{ value: '% Acumulado', angle: 90, position: 'insideRight', fontSize: 10 }} />
                    <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '12px' }} />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <Bar yAxisId="left" dataKey="count" name="Quantidade de Ocorrências" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                    <Line yAxisId="right" type="monotone" dataKey="cumulativePercentage" name="% Acumulado" stroke="#ef4444" strokeWidth={3} dot={{ r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Distribuição por Categoria 6M */}
          <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-4 shadow-sm">
            <div>
              <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                <PieIcon className="w-5 h-5 text-indigo-500" />
                Categorias Ishikawa (6M)
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Distribuição das causas de refugos entre os 6M industriais.
              </p>
            </div>

            <div className="h-64 w-full flex items-center justify-center">
              {metrics.sixMData && metrics.sixMData.some((item) => item.value > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={metrics.sixMData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {metrics.sixMData.map((entry) => (
                        <Cell key={entry.name} fill={SIX_M_COLORS[entry.name] || '#64748b'} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '12px' }} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-muted-foreground">Sem dados suficientes.</p>
              )}
            </div>
          </div>

          <div className="lg:col-span-3 grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-4 shadow-sm">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Activity className="w-5 h-5 text-sky-500" />
                  Tendência diária da Qualidade
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Reprovações registradas e taxa diária sobre leituras produtivas válidas.
                </p>
              </div>
              <div className="h-64">
                {metrics.pChartData?.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={metrics.pChartData} margin={{ top: 10, right: 10, left: -20, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="quantity" tick={{ fontSize: 10 }} allowDecimals={false} />
                      <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '12px' }} />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Bar yAxisId="quantity" dataKey="rejected" name="Reprovadas" fill="#ef4444" radius={[5, 5, 0, 0]} />
                      <Line yAxisId="rate" type="monotone" dataKey="rejectionRate" name="Taxa de reprovação (%)" stroke="#0ea5e9" strokeWidth={3} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Sem histórico diário suficiente.</div>
                )}
              </div>
            </div>

            <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-4 shadow-sm">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <Factory className="w-5 h-5 text-violet-500" />
                  Defeitos por célula produtiva
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Quantidade não conforme atribuída ao ponto de detecção.
                </p>
              </div>
              <div className="h-64">
                {metrics.byCellData?.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart layout="vertical" data={metrics.byCellData} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="cell" width={90} tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '12px' }} />
                      <Bar dataKey="defects" name="Defeitos" fill="#8b5cf6" radius={[0, 6, 6, 0]} />
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
    </div>
  );
}
