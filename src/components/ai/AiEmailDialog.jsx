import { useEffect, useState } from 'react';
import { Loader2, Mail, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import AiTemplateSelector from './AiTemplateSelector';

export default function AiEmailDialog({ open, onOpenChange, report, recipients = [], onSend, sending }) {
  const [selected, setSelected] = useState([]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('Segue o relatório industrial solicitado.');
  const [templateCode, setTemplateCode] = useState('manager-summary');
  useEffect(() => { if (report) setSubject(`[AC.Prod] ${report.title}`); }, [report]);
  const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="w-5 h-5" />Enviar relatório</DialogTitle><DialogDescription>O envio é realizado pela função segura do Supabase e fica registrado.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label>Modelo</Label><AiTemplateSelector value={templateCode} onChange={setTemplateCode} /></div><div className="space-y-2"><Label>Assunto</Label><Input value={subject} onChange={(event) => setSubject(event.target.value)} /></div><div className="space-y-2"><Label>Mensagem</Label><Textarea value={message} onChange={(event) => setMessage(event.target.value)} /></div><div className="space-y-2"><Label>Destinatários</Label><div className="max-h-48 overflow-y-auto border border-border rounded-md divide-y divide-border">{recipients.length ? recipients.filter((item) => item.active).map((recipient) => <label key={recipient.id} className="flex items-center gap-3 p-3 cursor-pointer"><Checkbox checked={selected.includes(recipient.id)} onCheckedChange={() => toggle(recipient.id)} /><span><strong className="block text-sm">{recipient.name}</strong><span className="text-xs text-muted-foreground">{recipient.email}</span></span></label>) : <p className="p-3 text-sm text-muted-foreground">Cadastre um gestor na aba Gestores.</p>}</div></div></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button disabled={sending || !selected.length} onClick={() => onSend({ reportJobId: report?.jobId, report, recipientIds: selected, templateCode, subject, message })} className="gap-2">{sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Enviar</Button></DialogFooter></DialogContent></Dialog>;
}
