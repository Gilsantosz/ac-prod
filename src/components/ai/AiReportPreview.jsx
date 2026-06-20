import { Download, Mail, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { IndustrialEmptyState, IndustrialSectionCard } from '@/components/industrial';
import AiInsightCards from './AiInsightCards';

export default function AiReportPreview({ report, onExport, onEmail }) {
  if (!report) {
    return <IndustrialEmptyState title="Nenhum relatório gerado" description="Preencha os filtros e gere uma análise para visualizar os indicadores." icon={ShieldCheck} />;
  }
  return (
    <div className="space-y-4">
      <AiInsightCards analysis={report.analysis} />
      <IndustrialSectionCard
        title={report.title}
        subtitle={`Gerado em ${new Date(report.generatedAt).toLocaleString('pt-BR')} · Rastreio ${report.traceId}`}
        icon={ShieldCheck}
        actions={<div className="flex gap-2"><Button variant="outline" size="sm" onClick={onEmail} disabled={!report.jobId} title={report.jobId ? 'Enviar relatório' : 'Publique a migração 013 para habilitar o envio'} className="gap-2"><Mail className="w-4 h-4" />Enviar</Button><Button size="sm" onClick={onExport} className="gap-2"><Download className="w-4 h-4" />Baixar {report.format.toUpperCase()}</Button></div>}
      >
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div><h4 className="text-sm font-semibold mb-3">Leitura operacional</h4><div className="space-y-2">{report.analysis.insights.map((item, index) => <div key={`${item.title}-${index}`} className="border border-border rounded-md p-3"><div className="flex items-center gap-2"><Badge variant={item.severity === 'critical' ? 'destructive' : 'outline'}>{item.severity === 'critical' ? 'Crítico' : item.severity === 'warning' ? 'Atenção' : 'Informativo'}</Badge><strong className="text-sm">{item.title}</strong></div><p className="text-sm text-muted-foreground mt-2">{item.detail}</p></div>)}</div></div>
          <div><h4 className="text-sm font-semibold mb-3">Ações sugeridas</h4><ol className="space-y-2">{report.analysis.recommendations.map((item, index) => <li key={item} className="flex gap-3 text-sm border-b border-border/50 pb-2"><span className="font-bold text-emerald-600">{index + 1}</span><span>{item}</span></li>)}</ol></div>
        </div>
        {report.options.includeCharts && report.analysis.byCell.length > 0 && <div className="mt-6 border-t border-border pt-5"><h4 className="text-sm font-semibold mb-3">Eficiência por célula</h4><div className="space-y-3">{report.analysis.byCell.slice(0, 10).map((cell) => <div key={cell.cell} className="grid grid-cols-[minmax(80px,160px)_1fr_62px] items-center gap-3 text-sm"><span className="truncate">{cell.cell}</span><div className="h-2.5 rounded-full bg-secondary overflow-hidden"><div className={`h-full ${cell.efficiency >= 95 ? 'bg-emerald-500' : cell.efficiency >= 80 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${Math.min(100, Math.max(0, cell.efficiency))}%` }} /></div><strong className="text-right">{cell.efficiency.toFixed(1)}%</strong></div>)}</div></div>}
        {report.options.includeLots && report.context.lots.length > 0 && <div className="mt-6 border-t border-border pt-5"><h4 className="text-sm font-semibold mb-3">Lotes no escopo</h4><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground border-b border-border"><th className="p-2">Lote</th><th className="p-2">Pedido</th><th className="p-2">Cliente</th><th className="p-2">Etapa</th><th className="p-2">Status</th><th className="p-2">Progresso</th></tr></thead><tbody>{report.context.lots.slice(0, 50).map((lot) => <tr key={lot.id} className="border-b border-border/50"><td className="p-2 font-medium">{lot.lot_code}</td><td className="p-2">{lot.production_orders?.order_code || '-'}</td><td className="p-2">{lot.production_orders?.customer_name || '-'}</td><td className="p-2">{lot.current_stage || '-'}</td><td className="p-2">{lot.status || '-'}</td><td className="p-2">{Number(lot.progress_percent || 0).toFixed(1)}%</td></tr>)}</tbody></table></div></div>}
        {report.context.warnings.length > 0 && <p className="mt-4 text-xs text-amber-700 dark:text-amber-400">Cobertura parcial: {report.context.warnings.join(' ')}</p>}
        {report.persistenceWarning && <p className="mt-2 text-xs text-muted-foreground">{report.persistenceWarning}</p>}
      </IndustrialSectionCard>
    </div>
  );
}
