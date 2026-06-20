import { ScrollText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { IndustrialEmptyState, IndustrialSectionCard } from '@/components/industrial';

export default function AiLogsPanel({ items = [], warning = '', title = 'Logs da IA' }) {
  return <IndustrialSectionCard title={title} subtitle="Eventos técnicos e de auditoria sem exposição de credenciais." icon={ScrollText}>{warning && <p className="mb-4 text-sm text-amber-700 dark:text-amber-400">{warning}</p>}{!items.length ? <IndustrialEmptyState title="Nenhum registro" description="As operações auditadas aparecerão aqui." icon={ScrollText} /> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b border-border text-muted-foreground"><th className="p-3">Data</th><th className="p-3">Evento</th><th className="p-3">Nível</th><th className="p-3">Mensagem</th><th className="p-3">Rastreio</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b border-border/50"><td className="p-3 whitespace-nowrap">{new Date(item.created_at).toLocaleString('pt-BR')}</td><td className="p-3 font-medium">{item.event || item.subject}</td><td className="p-3"><Badge variant={item.level === 'error' || item.status === 'failed' ? 'destructive' : 'outline'}>{item.level || item.status}</Badge></td><td className="p-3 text-muted-foreground">{item.message || item.recipient_email}</td><td className="p-3 font-mono text-xs">{item.trace_id?.slice(0, 8) || '-'}</td></tr>)}</tbody></table></div>}</IndustrialSectionCard>;
}

