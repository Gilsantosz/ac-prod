import {
  BarChart3, PieChart as PieIcon, Activity, Factory, X, Download
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { exportNonconformitiesCSV } from '@/lib/qualityService';
import { toast } from 'sonner';

export default function QualityChartDetailsModal({ open, onOpenChange, chartType, metrics }) {
  if (!chartType || !metrics) return null;

  let title = 'Detalhamento dos Indicadores';
  let subtitle = 'Análise granular das ocorrências de qualidade no período.';
  let Icon = BarChart3;
  let iconColor = 'text-amber-500';

  if (chartType === 'pareto') {
    title = 'Detalhamento do Pareto de Defeitos (80/20)';
    subtitle = 'Lista ordenada de tipos de defeito por frequência e contribuição acumulada.';
    Icon = BarChart3;
    iconColor = 'text-amber-500';
  } else if (chartType === 'ishikawa') {
    title = 'Detalhamento por Categorias Ishikawa (6M)';
    subtitle = 'Classificação das causas de refugo nos 6Ms da qualidade industrial.';
    Icon = PieIcon;
    iconColor = 'text-indigo-500';
  } else if (chartType === 'trend') {
    title = 'Detalhamento da Tendência Diária de Reprovações';
    subtitle = 'Histórico dia a dia de leituras válidas, reprovações e percentual de refugo.';
    Icon = Activity;
    iconColor = 'text-sky-500';
  } else if (chartType === 'byCell') {
    title = 'Detalhamento de Defeitos por Célula Produtiva';
    subtitle = 'Mapeamento do ponto de detecção das não conformidades na fábrica.';
    Icon = Factory;
    iconColor = 'text-violet-500';
  }

  const handleExportData = () => {
    try {
      exportNonconformitiesCSV(metrics.rawNCs || []);
      toast.success('Relatório CSV detalhado exportado com sucesso!');
    } catch (err) {
      console.error(err);
      toast.error('Falha ao exportar dados.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl rounded-3xl p-6 border-border bg-card shadow-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-black text-foreground flex items-center gap-2">
              <Icon className={`w-5 h-5 ${iconColor}`} />
              {title}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            {subtitle}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4 text-xs">
          {chartType === 'pareto' && (
            <div className="space-y-3">
              <div className="border border-border/60 rounded-2xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border/60 text-[11px] font-bold text-muted-foreground">
                      <th className="p-3">#</th>
                      <th className="p-3">Tipo de Defeito</th>
                      <th className="p-3 text-center">Quantidade</th>
                      <th className="p-3 text-center">% Relativa</th>
                      <th className="p-3 text-center">% Acumulado (80/20)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40 font-medium">
                    {metrics.paretoData && metrics.paretoData.length > 0 ? (
                      metrics.paretoData.map((row, idx) => (
                        <tr key={idx} className="hover:bg-muted/20">
                          <td className="p-3 font-bold text-muted-foreground">{idx + 1}</td>
                          <td className="p-3 font-bold text-foreground">{row.defect}</td>
                          <td className="p-3 text-center font-black text-amber-600 dark:text-amber-400">{row.count}</td>
                          <td className="p-3 text-center">{row.percentage}%</td>
                          <td className="p-3 text-center font-bold text-rose-600 dark:text-rose-400">{row.cumulativePercentage}%</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-muted-foreground">Sem registros no período.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {chartType === 'ishikawa' && (
            <div className="space-y-3">
              <div className="border border-border/60 rounded-2xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border/60 text-[11px] font-bold text-muted-foreground">
                      <th className="p-3">Categoria 6M</th>
                      <th className="p-3 text-center">Ocorrências</th>
                      <th className="p-3 text-center">Participação na Causa Raiz</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40 font-medium">
                    {metrics.sixMData && metrics.sixMData.length > 0 ? (
                      metrics.sixMData.map((row, idx) => {
                        const total = metrics.sixMData.reduce((acc, r) => acc + r.value, 0);
                        const pct = total > 0 ? ((row.value / total) * 100).toFixed(1) : '0';
                        return (
                          <tr key={idx} className="hover:bg-muted/20">
                            <td className="p-3 font-bold text-foreground">{row.name}</td>
                            <td className="p-3 text-center font-black text-indigo-600 dark:text-indigo-400">{row.value}</td>
                            <td className="p-3 text-center font-bold text-foreground">{pct}%</td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={3} className="p-6 text-center text-muted-foreground">Sem dados suficientes.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {chartType === 'trend' && (
            <div className="space-y-3">
              <div className="border border-border/60 rounded-2xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border/60 text-[11px] font-bold text-muted-foreground">
                      <th className="p-3">Data</th>
                      <th className="p-3 text-center">Leituras Aprovadas</th>
                      <th className="p-3 text-center">Reprovações</th>
                      <th className="p-3 text-center">Amostra Total</th>
                      <th className="p-3 text-center">Taxa de Refugo (%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40 font-medium">
                    {metrics.pChartData && metrics.pChartData.length > 0 ? (
                      metrics.pChartData.map((row, idx) => (
                        <tr key={idx} className="hover:bg-muted/20">
                          <td className="p-3 font-bold text-foreground">{row.date}</td>
                          <td className="p-3 text-center font-bold text-emerald-600">{row.approved}</td>
                          <td className="p-3 text-center font-black text-rose-600">{row.rejected}</td>
                          <td className="p-3 text-center">{row.sampleSize}</td>
                          <td className="p-3 text-center font-bold text-sky-600 dark:text-sky-400">{row.rejectionRate}%</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className="p-6 text-center text-muted-foreground">Sem histórico diário.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {chartType === 'byCell' && (
            <div className="space-y-3">
              <div className="border border-border/60 rounded-2xl overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border/60 text-[11px] font-bold text-muted-foreground">
                      <th className="p-3">Célula Produtiva / Etapa</th>
                      <th className="p-3 text-center">Total de Defeitos Detectados</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40 font-medium">
                    {metrics.byCellData && metrics.byCellData.length > 0 ? (
                      metrics.byCellData.map((row, idx) => (
                        <tr key={idx} className="hover:bg-muted/20">
                          <td className="p-3 font-bold text-foreground">{row.cell}</td>
                          <td className="p-3 text-center font-black text-purple-600 dark:text-purple-400">{row.defects}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={2} className="p-6 text-center text-muted-foreground">Sem defeitos atribuídos a células.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportData}
            className="w-full sm:w-auto h-9 rounded-xl text-xs font-bold flex items-center gap-1.5"
          >
            <Download className="w-4 h-4 text-emerald-600" />
            Exportar Dados (CSV)
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto h-9 rounded-xl text-xs font-bold"
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
