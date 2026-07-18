import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/lib/localDb';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Loader2, Plus, Calendar, Clock, FileText, Users, Send, Settings, Trash2, Edit3, X, Mail } from 'lucide-react';
import { useCells } from '@/hooks/useCells';

const REPORT_TYPES = [
  { value: 'daily_production', label: 'Produção Diária' },
  { value: 'shift_closure', label: 'Fechamento de Turno' },
  { value: 'oee', label: 'Análise de OEE' },
  { value: 'traceability_pending', label: 'Rastreabilidade Pendente' },
  { value: 'lots_delayed', label: 'Lotes em Atraso' },
  { value: 'packaging_pending', label: 'Embalagem Pendente' },
  { value: 'shipping_pending', label: 'Expedição Pendente' },
  { value: 'executive_summary', label: 'Resumo Executivo' },
];

const FREQUENCIES = [
  { value: 'daily', label: 'Diário' },
  { value: 'workdays', label: 'Dias Úteis' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensal' },
];

const FORMATS = [
  { value: 'pdf', label: 'PDF (Anexo)' },
  { value: 'xlsx', label: 'Excel (Anexo)' },
  { value: 'csv', label: 'CSV (Anexo)' },
  { value: 'email_html', label: 'Corpo do E-mail (HTML)' },
];

const emptySchedule = {
  name: '',
  report_type: 'daily_production',
  report_types: ['daily_production'],
  time_local: '07:00:00',
  frequency: 'daily',
  format: 'email_html',
  cell_filter: [],
  recipient_profile_ids: [],
  recipient_group_ids: [],
  extra_emails: '',
  enabled: true,
};

export default function ReportSchedulesManager() {
  const qc = useQueryClient();
  const { activeCells } = useCells();
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptySchedule);
  const [showForm, setShowForm] = useState(false);
  const [testingId, setTestingId] = useState(null);

  // Queries
  const { data: schedules = [], isLoading } = useQuery({
    queryKey: ['reportSchedules'],
    queryFn: () => base44.entities.ReportSchedule.list('-created_at'),
    initialData: [],
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list('-created_date', 500),
    initialData: [],
  });

  const { data: groups = [] } = useQuery({
    queryKey: ['emailRecipientGroups'],
    queryFn: () => base44.entities.EmailRecipientGroup.list('-created_at'),
    initialData: [],
  });

  const managersAndAdmins = users.filter((u) => u.role === 'manager' || u.role === 'admin' || u.role === 'supervisor' || u.report_delivery_enabled);

  // Mutations
  const saveSchedule = useMutation({
    mutationFn: (payload) => {
      const formatted = {
        ...payload,
        // Garante formato TIME correto (HH:MM:SS)
        time_local: payload.time_local.length === 5 ? `${payload.time_local}:00` : payload.time_local,
        extra_emails: payload.extra_emails
          ? payload.extra_emails.split(',').map((e) => e.trim()).filter((e) => e.includes('@'))
          : [],
        report_types: payload.report_types || [payload.report_type || 'daily_production'],
        recipient_group_ids: payload.recipient_group_ids || [],
      };
      return editing
        ? base44.entities.ReportSchedule.update(editing.id, formatted)
        : base44.entities.ReportSchedule.create(formatted);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reportSchedules'] });
      toast.success(editing ? 'Agendamento atualizado!' : 'Agendamento criado com sucesso!');
      setEditing(null);
      setForm(emptySchedule);
      setShowForm(false);
    },
    onError: (e) => toast.error(e?.message || 'Erro ao salvar agendamento'),
  });

  const deleteSchedule = useMutation({
    mutationFn: (id) => base44.entities.ReportSchedule.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reportSchedules'] });
      toast.success('Agendamento excluído.');
    },
    onError: () => toast.error('Falha ao excluir agendamento'),
  });

  const toggleScheduleStatus = useMutation({
    mutationFn: ({ id, enabled }) => base44.entities.ReportSchedule.update(id, { enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reportSchedules'] });
    },
  });

  const handleEdit = (s) => {
    setEditing(s);
    const initialReportTypes = s.report_types && s.report_types.length > 0
      ? s.report_types
      : (s.report_type ? [s.report_type] : ['daily_production']);
    setForm({
      name: s.name,
      report_type: initialReportTypes[0] || 'daily_production',
      report_types: initialReportTypes,
      time_local: s.time_local.slice(0, 5),
      frequency: s.frequency,
      format: s.format,
      cell_filter: s.cell_filter || [],
      recipient_profile_ids: s.recipient_profile_ids || [],
      recipient_group_ids: s.recipient_group_ids || [],
      extra_emails: (s.extra_emails || []).join(', '),
      enabled: s.enabled ?? true,
    });
    setShowForm(true);
  };

  const handleToggleReportType = (typeValue) => {
    setForm((f) => {
      const current = f.report_types || [];
      const updated = current.includes(typeValue)
        ? current.filter((t) => t !== typeValue)
        : [...current, typeValue];
      return {
        ...f,
        report_types: updated,
        report_type: updated[0] || 'daily_production',
      };
    });
  };

  const handleToggleCell = (cellName) => {
    setForm((f) => ({
      ...f,
      cell_filter: f.cell_filter.includes(cellName)
        ? f.cell_filter.filter((c) => c !== cellName)
        : [...f.cell_filter, cellName],
    }));
  };

  const handleToggleRecipient = (userId) => {
    setForm((f) => ({
      ...f,
      recipient_profile_ids: f.recipient_profile_ids.includes(userId)
        ? f.recipient_profile_ids.filter((id) => id !== userId)
        : [...f.recipient_profile_ids, userId],
    }));
  };

  const handleToggleGroup = (groupId) => {
    setForm((f) => ({
      ...f,
      recipient_group_ids: (f.recipient_group_ids || []).includes(groupId)
        ? f.recipient_group_ids.filter((id) => id !== groupId)
        : [...(f.recipient_group_ids || []), groupId],
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (!form.report_types || form.report_types.length === 0) {
      toast.error('Selecione pelo menos um tipo de relatório.');
      return;
    }
    saveSchedule.mutate(form);
  };

  const handleSendTest = async (id) => {
    setTestingId(id);
    try {
      // Invoca a edge function de envio de relatórios em modo de teste
      const { error } = await base44.functions.invoke('send-scheduled-reports', {
        body: { scheduleId: id, test: true }
      });
      if (error) throw error;
      toast.success('Relatório de teste enviado para a fila de entrega!');
    } catch (err) {
      toast.error('Erro ao enviar relatório de teste: ' + (err.message || err));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="font-semibold text-lg text-foreground">Relatórios Automáticos</h3>
          <p className="text-sm text-muted-foreground">Configure relatórios industriais periódicos com entrega automática por e-mail.</p>
        </div>
        {!showForm && (
          <Button onClick={() => { setForm(emptySchedule); setEditing(null); setShowForm(true); }} className="gap-1.5">
            <Plus className="w-4 h-4" /> Novo Agendamento
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="p-6 border-border/60 shadow-sm space-y-4">
          <div className="flex justify-between items-center border-b border-border/40 pb-2">
            <h4 className="font-semibold text-foreground flex items-center gap-1.5">
              <Settings className="w-4 h-4 text-primary" />
              {editing ? 'Editar Agendamento' : 'Novo Agendamento de Relatório'}
            </h4>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setShowForm(false); setEditing(null); }}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label>Nome do Agendamento</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: Resumo Diário OEE e Produção - Diretoria"
                  required
                />
              </div>
            </div>

            {/* Tipos de Relatório (Multi-select Badges) */}
            <div className="space-y-2">
              <Label>Tipos de Relatório</Label>
              <p className="text-xs text-muted-foreground">Selecione um ou mais relatórios para serem enviados juntos no mesmo e-mail.</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {REPORT_TYPES.map((t) => {
                  const selected = (form.report_types || []).includes(t.value);
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => handleToggleReportType(t.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                        selected
                          ? 'bg-primary text-primary-foreground border-primary font-medium'
                          : 'bg-transparent text-muted-foreground border-border hover:bg-secondary'
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Frequência</Label>
                <Select
                  value={form.frequency}
                  onValueChange={(val) => setForm((f) => ({ ...f, frequency: val }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((freq) => (
                      <SelectItem key={freq.value} value={freq.value}>{freq.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Horário Local (Brasília)</Label>
                <div className="relative">
                  <Clock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="time"
                    value={form.time_local}
                    onChange={(e) => setForm((f) => ({ ...f, time_local: e.target.value }))}
                    className="pl-9"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Formato</Label>
                <Select
                  value={form.format}
                  onValueChange={(val) => setForm((f) => ({ ...f, format: val }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FORMATS.map((formOption) => (
                      <SelectItem key={formOption.value} value={formOption.value}>{formOption.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Filtro por Célula */}
            <div className="space-y-2">
              <Label>Filtrar Células</Label>
              <p className="text-xs text-muted-foreground">Selecione quais células incluir no relatório. Deixe vazio para incluir todas.</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {activeCells.map((c) => {
                  const selected = form.cell_filter.includes(c.name);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleToggleCell(c.name)}
                      className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                        selected
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-transparent text-muted-foreground border-border hover:bg-secondary'
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Destinatários Gestores / Admins */}
            <div className="space-y-2">
              <Label>Destinatários Internos (Gestores / Admins)</Label>
              <p className="text-xs text-muted-foreground">Estes colaboradores cadastrados receberão o e-mail automaticamente.</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {managersAndAdmins.map((u) => {
                  const selected = form.recipient_profile_ids.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => handleToggleRecipient(u.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs border transition-colors flex items-center gap-1.5 ${
                        selected
                          ? 'bg-primary/10 text-primary border-primary/40 font-medium'
                          : 'bg-transparent text-muted-foreground border-border/60 hover:bg-secondary'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      {u.name || u.email.split('@')[0]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Grupos de Destinatários */}
            {groups.length > 0 && (
              <div className="space-y-2">
                <Label>Grupos de Destinatários</Label>
                <p className="text-xs text-muted-foreground">Todos os membros dos grupos selecionados receberão o e-mail.</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {groups.map((g) => {
                    const selected = (form.recipient_group_ids || []).includes(g.id);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => handleToggleGroup(g.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs border transition-colors flex items-center gap-1.5 ${
                          selected
                            ? 'bg-indigo-600/10 text-indigo-600 border-indigo-600/40 font-medium dark:text-indigo-400'
                            : 'bg-transparent text-muted-foreground border-border/60 hover:bg-secondary'
                        }`}
                      >
                        <Users className="w-3.5 h-3.5 text-indigo-500" />
                        {g.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* E-mails Adicionais */}
            <div className="space-y-2">
              <Label>Destinatários Externos (E-mails Adicionais)</Label>
              <p className="text-xs text-muted-foreground">Digite e-mails separados por vírgula (Ex: diretor@leo.com.br, supervisor@leo.com.br).</p>
              <Input
                value={form.extra_emails}
                onChange={(e) => setForm((f) => ({ ...f, extra_emails: e.target.value }))}
                placeholder="email1@empresa.com, email2@empresa.com"
              />
            </div>

            {/* Ações */}
            <div className="flex justify-end gap-2 pt-3 border-t border-border/40">
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); }} className="gap-2">
                <X className="w-4 h-4" /> Cancelar
              </Button>
              <Button type="submit" disabled={saveSchedule.isPending} className="gap-2 px-5">
                {saveSchedule.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
                {editing ? 'Salvar Alterações' : 'Criar Agendamento'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {isLoading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : schedules.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground border-dashed border-border/80">
          Nenhum relatório agendado. Clique em "Novo Agendamento" para começar.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {schedules.map((s) => {
            const scheduleReportTypes = s.report_types && s.report_types.length > 0
              ? s.report_types
              : (s.report_type ? [s.report_type] : []);
            const reportTypesLabels = scheduleReportTypes
              .map((t) => REPORT_TYPES.find((rt) => rt.value === t)?.label || t)
              .join(', ');
            const frequencyLabel = FREQUENCIES.find((f) => f.value === s.frequency)?.label || s.frequency;
            const formatLabel = FORMATS.find((f) => f.value === s.format)?.label || s.format;

            // Encontrar nomes dos destinatários
            const recipientNames = (s.recipient_profile_ids || [])
              .map((id) => users.find((u) => u.id === id)?.name || 'Usuário')
              .filter(Boolean);

            return (
              <Card key={s.id} className="p-4 sm:p-5 border-border/60 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm hover:border-border transition-colors">
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold text-foreground text-base leading-none">{s.name}</h4>
                    <Badge variant={s.enabled ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">
                      {s.enabled ? 'Ativo' : 'Pausado'}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-primary" />
                      {reportTypesLabels} ({formatLabel})
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-primary" />
                      {frequencyLabel}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-primary" />
                      {s.time_local.slice(0, 5)} (Brasília)
                    </span>
                  </div>

                  {/* Detalhes de Destinatários e Células */}
                  <div className="space-y-1">
                    {recipientNames.length > 0 && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        Destinatários: <span className="font-medium text-foreground">{recipientNames.join(', ')}</span>
                      </p>
                    )}
                    {s.recipient_group_ids && s.recipient_group_ids.length > 0 && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-indigo-500" />
                        Grupos: <span className="font-medium text-foreground">
                          {s.recipient_group_ids.map((id) => groups.find((g) => g.id === id)?.name).filter(Boolean).join(', ')}
                        </span>
                      </p>
                    )}
                    {s.extra_emails && s.extra_emails.length > 0 && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5" />
                        E-mails extras: <span className="font-medium text-foreground">{(s.extra_emails).join(', ')}</span>
                      </p>
                    )}
                    {s.cell_filter && s.cell_filter.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Filtro de células: <span className="font-medium text-foreground">{(s.cell_filter).join(', ')}</span>
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 shrink-0 self-end md:self-center">
                  <div className="flex items-center gap-2 border-r border-border/40 pr-3">
                    <span className="text-xs text-muted-foreground">Status:</span>
                    <Switch
                      checked={s.enabled ?? true}
                      onCheckedChange={(val) => toggleScheduleStatus.mutate({ id: s.id, enabled: val })}
                    />
                  </div>

                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 text-xs"
                      onClick={() => handleSendTest(s.id)}
                      disabled={testingId === s.id}
                    >
                      {testingId === s.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      Testar Agora
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="w-8 h-8 rounded-lg"
                      onClick={() => handleEdit(s)}
                    >
                      <Edit3 className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="w-8 h-8 rounded-lg hover:bg-destructive/10 hover:border-destructive/30"
                      onClick={() => {
                        if (confirm('Deseja excluir este agendamento permanentemente?')) {
                          deleteSchedule.mutate(s.id);
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive transition-colors" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
