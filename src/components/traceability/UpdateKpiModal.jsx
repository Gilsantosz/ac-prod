import { useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export default function UpdateKpiModal({ open, onClose, stats = {}, updatedAt, onRefresh }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const refresh = async () => {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      if (!onRefresh) throw new Error('Atualização indisponível. Reabra a página.');
      await onRefresh();
      toast.success('Indicadores sincronizados com os lotes atuais.');
      onClose();
    } catch (err) {
      setError(err?.message || 'Não foi possível atualizar. Tente novamente.');
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };
  return <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose(); if (next) setError(''); }}>
    <DialogContent onEscapeKeyDown={(e) => { if (saving) e.preventDefault(); }} onPointerDownOutside={(e) => { if (saving) e.preventDefault(); }}>
      <DialogHeader><DialogTitle>Atualizar indicadores</DialogTitle><DialogDescription>Consulte novamente os lotes para atualizar os totais e o Kanban. Os indicadores são calculados pelos registros de produção.</DialogDescription></DialogHeader>
      <div className="grid grid-cols-2 gap-3">{[['total', 'Lotes'], ['blocked', 'Bloqueados'], ['late', 'Em atraso'], ['completed', 'Finalizados']].map(([key, label]) => <div key={key} className="rounded-xl border border-border bg-secondary/20 p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold tabular-nums">{stats[key] ?? '—'}</p></div>)}</div>
      <p className="text-xs text-muted-foreground">Última consulta: {updatedAt ? new Date(updatedAt).toLocaleString('pt-BR') : 'Aguardando dados'}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" disabled={saving} onClick={onClose}>Cancelar</Button><Button disabled={saving} onClick={refresh} className="gap-2"><RefreshCw className={`h-4 w-4 ${saving ? 'animate-spin' : ''}`} />{saving ? 'Atualizando…' : 'Atualizar agora'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
