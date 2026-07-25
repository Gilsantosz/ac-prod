import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldAlert, BarChart3,
  Download, RefreshCw, Layers,
  PieChart as PieIcon, Activity
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

export default function QualityPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('pareto'); // 'pareto' | 'ncs' | 'spc' | 'catalog'

  const userPermissions = {
    manage_quality: user?.role === 'admin' || user?.role === 'manager' || user?.permissions?.manage_quality,
    close_quality_nonconformities: user?.role === 'admin' || user?.role === 'manager' || user?.permissions?.close_quality_nonconformities,
    admin: user?.role === 'admin'
  };

  const { data: metrics = {}, isLoading, refetch } = useQuery({
    queryKey: ['quality-metrics'],
    queryFn: () => getQualityDashboardMetrics(),
    refetchInterval: 20000
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
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
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
            className="h-10 rounded-xl border-border/60 text-xs font-bold flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Cards Principais de Indicadores */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-card border border-border/60 rounded-2xl p-4 space-y-1 shadow-sm">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">First Pass Yield (FPY)</p>
          <p className="text-3xl font-black text-emerald-600 dark:text-emerald-400">{metrics.fpy || 100}%</p>
          <p className="text-[11px] text-muted-foreground">Aprovação de 1ª Passagem</p>
        </div>

        <div className="bg-card border border-border/60 rounded-2xl p-4 space-y-1 shadow-sm">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Taxa de Reprovação</p>
          <p className="text-3xl font-black text-rose-600 dark:text-rose-400">{metrics.rejectionRate || 0}%</p>
          <p className="text-[11px] text-muted-foreground">Refugos / Leituras totais</p>
        </div>

        <div className="bg-card border border-border/60 rounded-2xl p-4 space-y-1 shadow-sm">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Não Conformidades Abertas</p>
          <p className="text-3xl font-black text-amber-600 dark:text-amber-400">{metrics.openNCs || 0}</p>
          <p className="text-[11px] text-muted-foreground">Requerem tratativa / 5W2H</p>
        </div>

        <div className="bg-card border border-border/60 rounded-2xl p-4 space-y-1 shadow-sm">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">NCs Encerradas</p>
          <p className="text-3xl font-black text-foreground">{metrics.closedNCs || 0}</p>
          <p className="text-[11px] text-muted-foreground">Concluídas com sucesso</p>
        </div>
      </div>

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
              {metrics.sixMData && metrics.sixMData.length > 0 ? (
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
