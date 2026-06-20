import { FileClock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { IndustrialEmptyState, IndustrialSectionCard } from '@/components/industrial';

export default function AiReportHistory({ items = [], warning = '' }) {
  return (
    <IndustrialSectionCard title="Relatórios gerados" subtitle="Histórico auditável de solicitações e arquivos." icon={FileClock}>
      {warning && <p className="mb-4 text-sm text-amber-700 dark:text-amber-400">{warning}</p>}
      {!items.length ? <IndustrialEmptyState title="Histórico vazio" description="Os relatórios gerados aparecerão aqui." icon={FileClock} /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-muted-foreground"><th className="p-3">Relatório</th><th className="p-3">Formato</th><th className="p-3">Status</th><th className="p-3">Data</th><th className="p-3">Rastreio</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b border-border/50"><td className="p-3 font-medium">{item.title}</td><td className="p-3 uppercase">{item.format}</td><td className="p-3"><Badge variant={item.status === 'completed' ? 'outline' : 'secondary'}>{item.status}</Badge></td><td className="p-3">{new Date(item.created_at).toLocaleString('pt-BR')}</td><td className="p-3 font-mono text-xs">{item.trace_id?.slice(0, 8)}</td></tr>)}</tbody></table></div>}
    </IndustrialSectionCard>
  );
}

