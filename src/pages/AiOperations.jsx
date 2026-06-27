import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CalendarClock, FileBarChart, FileClock, MailCheck, ScrollText, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { IndustrialModeTabs, IndustrialPageShell } from '@/components/industrial';
import { useAuth } from '@/lib/AuthContext';
import { canUseAiOperations, fetchAiMetadata } from '@/lib/ai/aiContextService';
import { generateOperationalReport, listReportJobs, createScheduledReport } from '@/lib/ai/aiReportService';
import { deleteReportRecipient, listEmailLogs, listReportRecipients, saveReportRecipient, sendReportEmail } from '@/lib/ai/aiEmailService';
import { listAiLogs } from '@/lib/ai/aiAuditService';
import { exportOperationalReport } from '@/lib/reports/reportExportService';
import AiAssistantPanel from '@/components/ai/AiAssistantPanel';
import AiEmailDialog from '@/components/ai/AiEmailDialog';
import AiLogsPanel from '@/components/ai/AiLogsPanel';
import AiRecipientsManager from '@/components/ai/AiRecipientsManager';
import AiReportHistory from '@/components/ai/AiReportHistory';
import AiReportPreview from '@/components/ai/AiReportPreview';
import AiReportRequestForm from '@/components/ai/AiReportRequestForm';
import AiScheduleDialog from '@/components/ai/AiScheduleDialog';

const tabs = [
  { value: 'ask', label: 'Perguntar à IA', icon: Bot },
  { value: 'request', label: 'Solicitar Relatório', icon: FileBarChart },
  { value: 'history', label: 'Relatórios Gerados', icon: FileClock },
  { value: 'deliveries', label: 'Envios', icon: MailCheck },
  { value: 'managers', label: 'Gestores', icon: UsersRound },
  { value: 'logs', label: 'Logs', icon: ScrollText },
];

export default function AiOperations() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('ask');
  const [report, setReport] = useState(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // canManage: admin e manager podem gerenciar destinatários/agendamentos (alinhado com RLS do banco)
  // canManage NÃO inclui operadores com manage_automations, pois a RLS bloqueia INSERT/DELETE em report_recipients para não-admin/manager
  const canManage = user?.role === 'admin' || user?.role === 'manager';

  const metadataQuery = useQuery({ queryKey: ['ai-metadata', user?.id], queryFn: () => fetchAiMetadata(user), enabled: !!user });
  const historyQuery = useQuery({ queryKey: ['ai-report-jobs'], queryFn: () => listReportJobs(), enabled: tab === 'history' });
  const recipientsQuery = useQuery({ queryKey: ['ai-report-recipients'], queryFn: listReportRecipients, enabled: ['request', 'managers'].includes(tab) || emailOpen });
  const deliveriesQuery = useQuery({ queryKey: ['ai-email-logs'], queryFn: listEmailLogs, enabled: tab === 'deliveries' });
  const logsQuery = useQuery({ queryKey: ['ai-system-logs'], queryFn: () => listAiLogs(), enabled: tab === 'logs' });

  const generateMutation = useMutation({
    mutationFn: (payload) => generateOperationalReport({ ...payload, user }),
    onSuccess: (generated) => {
      setReport(generated);
      queryClient.invalidateQueries({ queryKey: ['ai-report-jobs'] });
      toast.success('Relatório gerado com dados reais do período.');
    },
    onError: (error) => toast.error(error.message),
  });
  const recipientMutation = useMutation({
    mutationFn: saveReportRecipient,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ai-report-recipients'] }); toast.success('Destinatário salvo.'); },
    onError: (error) => toast.error(error.message),
  });
  const deleteRecipientMutation = useMutation({
    mutationFn: deleteReportRecipient,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-report-recipients'] }),
    onError: (error) => toast.error(error.message),
  });
  const emailMutation = useMutation({
    mutationFn: sendReportEmail,
    onSuccess: () => { setEmailOpen(false); queryClient.invalidateQueries({ queryKey: ['ai-email-logs'] }); toast.success('Relatório enviado e registrado.'); },
    onError: (error) => toast.error(error.message),
  });
  const scheduleMutation = useMutation({
    mutationFn: (payload) => createScheduledReport(payload, user),
    onSuccess: () => { setScheduleOpen(false); toast.success('Agendamento criado.'); },
    onError: (error) => toast.error(error.message),
  });

  if (!canUseAiOperations(user)) {
    return <IndustrialPageShell><div className="border border-amber-300 bg-amber-50 dark:bg-amber-950/20 rounded-md p-5"><h1 className="text-lg font-bold">Acesso restrito</h1><p className="text-sm text-muted-foreground mt-1">Solicite a permissão IA Operacional ou Relatórios ao administrador.</p></div></IndustrialPageShell>;
  }

  const metadata = metadataQuery.data || { cells: [], operators: [], managers: [] };
  return (
    <IndustrialPageShell maxWidth="max-w-[1600px]">
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div><div className="flex items-center gap-2 text-xs font-bold uppercase text-emerald-700 dark:text-emerald-400"><Bot className="w-4 h-4" />Análise contextual e auditável</div><h1 className="text-3xl sm:text-4xl font-extrabold text-foreground mt-1">Leo Flow Copilot Industrial</h1><p className="text-sm text-muted-foreground mt-2 max-w-3xl">Consulte a operação, gere relatórios Leo Madeiras, envie aos gestores e acompanhe cada execução.</p></div>
        {report && <Button variant="outline" onClick={() => setScheduleOpen(true)} disabled={!canManage} className="gap-2"><CalendarClock className="w-4 h-4" />Agendar relatório</Button>}
      </header>
      <IndustrialModeTabs items={tabs} value={tab} onChange={setTab} />
      {tab === 'ask' && <AiAssistantPanel user={user} />}
      {tab === 'request' && <div className="space-y-5"><AiReportRequestForm metadata={metadata} loading={generateMutation.isPending} onGenerate={generateMutation.mutate} /><AiReportPreview report={report} onExport={() => exportOperationalReport(report).catch((error) => toast.error(error.message))} onEmail={() => setEmailOpen(true)} /></div>}
      {tab === 'history' && <AiReportHistory items={historyQuery.data?.data} warning={historyQuery.data?.warning} />}
      {tab === 'deliveries' && <AiLogsPanel title="Envios de relatórios" items={deliveriesQuery.data?.data} warning={deliveriesQuery.data?.warning} />}
      {tab === 'managers' && <AiRecipientsManager items={recipientsQuery.data?.data} warning={recipientsQuery.data?.warning} canManage={canManage} saving={recipientMutation.isPending} onSave={recipientMutation.mutateAsync} onDelete={deleteRecipientMutation.mutate} />}
      {tab === 'logs' && <AiLogsPanel items={logsQuery.data?.data} warning={logsQuery.data?.warning} />}
      <AiEmailDialog open={emailOpen} onOpenChange={setEmailOpen} report={report} recipients={recipientsQuery.data?.data || []} onSend={emailMutation.mutate} sending={emailMutation.isPending} />
      <AiScheduleDialog open={scheduleOpen} onOpenChange={setScheduleOpen} report={report} recipients={recipientsQuery.data?.data || []} onSave={scheduleMutation.mutate} />
    </IndustrialPageShell>
  );
}
