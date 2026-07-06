import { canExecuteAiAction } from './aiPermissionService';
import { generateOperationalReport } from './aiReportService';
import { sendReportEmailSmart, listEmailLogs } from './aiEmailService';
import { listAiLogs } from './aiAuditService';
import { createScheduleFromCommand, listSchedulesFromPrompt, cancelScheduleFromPrompt } from './aiScheduleCommandService';
import { resolveRecipientsFromPrompt } from './aiRecipientResolver';
import { parseProductionQuestion, searchProductionContext } from './aiProductionSearchService';
import { NAVIGATION_TOPICS } from '@/lib/assistant/assistantEngine';
import { supabase } from '@/lib/supabaseClient';

function reportLabel(type) {
  const map = {
    oee: 'Relatório OEE',
    production_summary: 'Resumo de Produção',
    daily_production: 'Resumo Diário de Produção',
    shift_closure: 'Fechamento de Turno',
    cell_performance: 'Desempenho por Célula',
    lot_traceability: 'Relatório de Rastreabilidade',
    occurrences: 'Relatório de Ocorrências',
    executive: 'Resumo Executivo',
  };
  return map[type] || type;
}

function periodLabel(filters) {
  if (!filters?.startDate || !filters?.endDate) return 'período não especificado';
  return filters.startDate === filters.endDate
    ? filters.startDate.split('-').reverse().join('/')
    : `${filters.startDate.split('-').reverse().join('/')} a ${filters.endDate.split('-').reverse().join('/')}`;
}

export async function executeAiAction(actionPlan, { user, conversationContext = {} } = {}) {
  const { action, reportType, format, filters, schedule, templateCode, subject, message } = actionPlan;

  // 1. Check Permissions
  if (!canExecuteAiAction(user, action, { cell: filters?.cell })) {
    await supabase.from('ai_system_logs').insert({
      user_id: user?.id,
      event: 'ai.action.denied',
      level: 'security',
      message: `Acesso negado para ação ${action} no escopo do usuário ${user?.email}`,
      success: false,
    });
    return {
      content: 'Você não possui permissão para executar esta ação com seu perfil atual.',
    };
  }

  // 2. Resolve Recipients for send/schedule actions
  let resolvedRecs = null;
  if (['send_report_email', 'schedule_report_email'].includes(action)) {
    const prompt = actionPlan.rawPrompt || user.prompt || '';
    resolvedRecs = await resolveRecipientsFromPrompt(prompt, user, { explicitRecipients: actionPlan.recipients });

    // Se houver ambiguidade, retorna imediatamente exigindo confirmação do destinatário correto
    if (resolvedRecs.ambiguous.length > 0) {
      const amb = resolvedRecs.ambiguous[0];
      return {
        content: `Encontrei mais de um destinatário correspondente para "${amb.requested}". Escolha a opção correta:`,
        pendingAction: {
          type: action,
          payload: { ...actionPlan, recipientsResolved: true },
        },
        actions: amb.matches.map(m => ({
          label: `${m.name} (${m.email})`,
          action: 'confirm_pending_action',
          payloadOverride: { recipients: [m.email] },
        })).concat([{ label: 'Cancelar', action: 'cancel_pending_action' }]),
      };
    }

    // Se nenhum destinatário for encontrado e for uma ação de envio
    if (resolvedRecs.resolved.length === 0 && action === 'send_report_email') {
      return {
        content: 'Não consegui identificar nenhum destinatário válido para o envio do relatório. Por favor, informe o nome ou e-mail do gestor (ex: "para carlos@empresa.com").',
      };
    }
  }

  // 3. Confirmations (External Domains, Cancelations, High Volumes)
  if (action === 'send_report_email' && resolvedRecs) {
    const userDomain = String(user?.email || '').split('@')[1]?.toLowerCase();
    const externalRecs = resolvedRecs.resolved.filter(r => {
      const recDomain = String(r.email || '').split('@')[1]?.toLowerCase();
      return recDomain && recDomain !== userDomain;
    });

    // Se for e-mail externo e não estiver na flag confirmada
    if (externalRecs.length > 0 && !actionPlan.confirmedExternal) {
      return {
        content: `Atenção: O destinatário "${externalRecs[0].email}" possui um domínio de e-mail externo. Confirma o envio?`,
        pendingAction: {
          type: 'send_report_email',
          payload: { ...actionPlan, confirmedExternal: true },
        },
        actions: [
          { label: 'Confirmar envio externo', action: 'confirm_pending_action' },
          { label: 'Cancelar', action: 'cancel_pending_action' },
        ],
      };
    }

    if (resolvedRecs.resolved.length > 10 && !actionPlan.confirmedVolume) {
      return {
        content: `Você está prestes a enviar este relatório para ${resolvedRecs.resolved.length} destinatários. Confirma o envio em massa?`,
        pendingAction: {
          type: 'send_report_email',
          payload: { ...actionPlan, confirmedVolume: true },
        },
        actions: [
          { label: 'Confirmar envio em massa', action: 'confirm_pending_action' },
          { label: 'Cancelar', action: 'cancel_pending_action' },
        ],
      };
    }
  }

  // 4. Executores Específicos
  if (action === 'generate_report') {
    const report = await generateOperationalReport({
      user,
      reportType: reportType || 'production_summary',
      format: format || 'pdf',
      title: `${reportLabel(reportType)} - ${periodLabel(filters)}`,
      filters,
      options: { requestedByAi: true },
    });

    if (!report.context?.entries?.length) {
      return {
        content: `Relatório ${reportLabel(reportType)} gerado para o período ${periodLabel(filters)}, porém não foram encontrados lançamentos de produção. O arquivo não possui dados.`,
      };
    }

    return {
      content: `Relatório ${report.title} gerado com sucesso com dados reais.`,
      contextPatch: { lastReport: report, lastFilters: filters },
      actions: report.jobId ? [{ label: 'Visualizar Relatório', path: `/relatorios?jobId=${report.jobId}` }] : [],
    };
  }

  if (action === 'send_report_email') {
    let report = conversationContext.lastReport;
    const currentFilters = filters || conversationContext.lastFilters;

    // Se não há relatório na memória ou os filtros mudaram, gera um novo
    if (!report || (currentFilters && JSON.stringify(report.filters) !== JSON.stringify(currentFilters))) {
      report = await generateOperationalReport({
        user,
        reportType: reportType || 'production_summary',
        format: format || 'pdf',
        title: `${reportLabel(reportType)} - ${periodLabel(currentFilters)}`,
        filters: currentFilters,
        options: { requestedByAi: true },
      });
    }

    if (!report.context?.entries?.length) {
      return {
        content: `Não há dados para gerar o relatório ${reportLabel(reportType || report.reportType)} no período ${periodLabel(currentFilters)}. O e-mail não foi enviado.`,
      };
    }

    const recipientIds = resolvedRecs.resolved.map(r => r.id).filter(Boolean);
    const directRecipients = resolvedRecs.resolved.filter(r => !r.id).map(r => ({ name: r.name, email: r.email }));

    const result = await sendReportEmailSmart({
      reportJobId: report.jobId,
      recipientIds,
      directRecipients,
      templateCode: templateCode || 'manager-summary',
      subject: subject || `[Leo Flow] ${report.title}`,
      message: message || `Segue o relatório ${reportLabel(reportType || report.reportType)} solicitado para o período ${periodLabel(currentFilters)}.`,
      user,
    });

    const recsNames = resolvedRecs.resolved.map(r => `${r.name} (${r.email})`).join(', ');

    return {
      content: `Relatório "${report.title}" enviado com sucesso para: ${recsNames}. Envio auditado nos logs do sistema.`,
      contextPatch: { lastReport: report, lastFilters: currentFilters },
    };
  }

  if (action === 'schedule_report_email') {
    return createScheduleFromCommand(actionPlan, user, { resolvedRecipients: resolvedRecs });
  }

  if (action === 'list_schedules') {
    return listSchedulesFromPrompt(actionPlan.rawPrompt, user);
  }

  if (action === 'cancel_schedule') {
    if (!actionPlan.confirmedCancel) {
      return {
        content: 'Você tem certeza que deseja cancelar e remover este agendamento?',
        pendingAction: {
          type: 'cancel_schedule',
          payload: { ...actionPlan, confirmedCancel: true },
        },
        actions: [
          { label: 'Confirmar cancelamento', action: 'confirm_pending_action' },
          { label: 'Manter agendamento', action: 'cancel_pending_action' },
        ],
      };
    }
    return cancelScheduleFromPrompt(actionPlan.rawPrompt, user);
  }

  if (action === 'show_email_logs') {
    const logs = await listEmailLogs(10);
    if (!logs.data || logs.data.length === 0) {
      return { content: 'Não foram encontrados logs de envio de e-mail recentes.' };
    }
    const items = logs.data.map(l => `- **${l.subject}** enviado para **${l.recipient_email}** em ${new Date(l.created_at).toLocaleString('pt-BR')} (Status: **${l.status}**)`).join('\n');
    return {
      content: `Últimos envios de relatórios:\n\n${items}`,
    };
  }

  if (action === 'show_ai_logs') {
    const logs = await listAiLogs(10);
    if (!logs || logs.length === 0) {
      return { content: 'Não há logs de auditoria do Copilot registrados.' };
    }
    const items = logs.map(l => `- [${l.level.toUpperCase()}] **${l.event}** por usuário em ${new Date(l.created_at).toLocaleString('pt-BR')}: ${l.message || 'Sem descrição'}`).join('\n');
    return {
      content: `Histórico recente de logs do Copilot:\n\n${items}`,
    };
  }

  if (action === 'navigate') {
    const cleanPrompt = actionPlan.rawPrompt?.toLowerCase() || '';
    const match = NAVIGATION_TOPICS.find(t => t.keywords.some(k => cleanPrompt.includes(k)));
    if (match) {
      return {
        content: `Estou te redirecionando para a tela de **${match.label}** (${match.description}).`,
        actions: [{ label: `Ir para ${match.label}`, path: match.path }],
      };
    }
    return {
      content: 'Não consegui identificar qual tela você deseja abrir. Por favor, mencione uma tela como: Painel, Ocorrências, OEE ou Rastreabilidade.',
    };
  }

  if (action === 'search_production') {
    const searchIntent = parseProductionQuestion(actionPlan.rawPrompt || '');
    const searchFilters = buildProductionFilters(searchIntent);
    const result = await searchProductionContext(searchFilters);

    if (result.contexts?.length > 0) {
      const details = result.contexts.map(c => {
        return `• Lote **${c.lot?.lot_code || '—'}**: Célula atual **${c.lot?.current_cell || '—'}** (${c.lot?.current_status === 'completed' ? 'Finalizado' : 'Em andamento'}).`;
      }).join('\n');
      return {
        content: `Encontrei as seguintes informações de produção:\n\n${details}`,
        actions: result.lots?.[0] ? [{ label: 'Ver na Rastreabilidade', path: `/rastreabilidade?search=${result.lots[0].lot_code}` }] : [],
      };
    }
    return {
      content: 'Nenhum registro de produção (lote, pedido ou carga) correspondente foi encontrado com os dados informados.',
    };
  }

  return {
    content: 'Comando operacional não reconhecido ou incompleto.',
  };
}
