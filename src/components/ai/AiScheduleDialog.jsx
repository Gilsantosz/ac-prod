import { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import AiTemplateSelector from './AiTemplateSelector';

export default function AiScheduleDialog({ open, onOpenChange, report, recipients = [], onSave }) {
  const [frequency, setFrequency] = useState('daily');
  const [timeLocal, setTimeLocal] = useState('07:00');
  const [recipientIds, setRecipientIds] = useState([]);
  const [templateCode, setTemplateCode] = useState('manager-summary');
  const toggle = (id) => setRecipientIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle className="flex gap-2 items-center"><CalendarClock className="w-5 h-5" />Agendar relatório</DialogTitle><DialogDescription>O processamento ocorrerá no servidor no horário configurado.</DialogDescription></DialogHeader><div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label>Frequência</Label><Select value={frequency} onValueChange={setFrequency}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="daily">Diário</SelectItem><SelectItem value="workdays">Dias úteis</SelectItem><SelectItem value="weekly">Semanal</SelectItem><SelectItem value="monthly">Mensal</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label>Horário</Label><Input type="time" value={timeLocal} onChange={(event) => setTimeLocal(event.target.value)} /></div><div className="space-y-2 col-span-2"><Label>Modelo de e-mail</Label><AiTemplateSelector value={templateCode} onChange={setTemplateCode} /></div><div className="space-y-2 col-span-2"><Label>Destinatários</Label><div className="max-h-36 overflow-y-auto border border-border rounded-md divide-y divide-border">{recipients.map((item) => <label key={item.id} className="flex items-center gap-2 p-2 text-sm"><Checkbox checked={recipientIds.includes(item.id)} onCheckedChange={() => toggle(item.id)} />{item.name} · {item.email}</label>)}</div></div></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button disabled={!recipientIds.length} onClick={() => onSave({ name: report?.title, reportType: report?.reportType, format: report?.format, filters: report?.filters, options: report?.options, frequency, timeLocal, recipientIds, templateCode })}>Agendar</Button></DialogFooter></DialogContent></Dialog>;
}
