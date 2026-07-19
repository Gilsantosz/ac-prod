import { supabase } from '@/lib/supabaseClient';
import { createScheduledReport, listScheduledReports } from './aiReportService';
import { parseIntent } from './aiIntentParser';
import { resolveRecipientsFromPrompt } from './aiRecipientResolver';

function frequencyLabel(freq) {
  const map = {
    once: 'uma única vez',
    daily: 'diariamente',
    workdays: 'dias úteis',
    weekly: 'semanalmente',
    monthly: 'mensalmente',
  };
  return map[freq] || freq;
}

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
    lots_delayed: 'Relatório de Lotes Atrasados',
    packaging_pending: 'Relatório de Embalagem Pendente',
    shipping_pending: 'Relatório de Expedição Pendente',
  };
  return map[type] || type;
}

export async function createScheduleFromCommand(command, user, options = {}) {
  const resolvedRecs = options.resolvedRecipients
    || await resolveRecipientsFromPrompt(command.rawPrompt || user.prompt || '', user, { explicitRecipients: command.recipients });
  const recipientIds = resolvedRecs.resolved.map(r => r.profile_id).filter(Boolean);

  const payload = {
    name: `${reportLabel(command.reportType)} agendado via Copilot`,
    reportType: command.reportType || 'production_summary',
    format: command.format || 'pdf',
    filters: command.filters || {},
    options: { requestedByAi: true },
    frequency: command.schedule?.frequency || 'daily',
    timeLocal: command.schedule?.timeLocal || '07:00',
    recipientProfileIds: recipientIds,
    templateCode: command.templateCode || 'manager-summary',
  };


  const schedule = await createScheduledReport(payload, user);
  return {
    success: true,
    schedule,
    message: `Agendamento criado com sucesso: ${reportLabel(command.reportType)}, ${frequencyLabel(payload.frequency)} às ${payload.timeLocal}, para os destinatários selecionados.`,
  };
}

export async function listSchedulesFromPrompt(prompt, user) {
  const { data: schedules, error } = await listScheduledReports();
  if (error) throw error;
  if (!schedules || schedules.length === 0) {
    return {
      content: 'Não há relatórios agendados ativos no sistema.',
      schedules: [],
    };
  }

  const items = schedules.map(s => {
    return `- **${s.name}** (${reportLabel(s.report_type)}): ${frequencyLabel(s.frequency)} às ${s.time_local.slice(0, 5)} (Próximo envio: ${s.next_run_at ? new Date(s.next_run_at).toLocaleString('pt-BR') : 'não agendado'})`;
  }).join('\n');

  return {
    content: `Encontrei os seguintes relatórios agendados:\n\n${items}`,
    schedules,
  };
}

export async function cancelScheduleFromPrompt(prompt, user) {
  const intent = parseIntent(prompt);
  // Procurar por nome ou tipo do relatório no prompt
  const { data: schedules } = await listScheduledReports();
  if (!schedules || schedules.length === 0) {
    throw new Error('Não há relatórios agendados para cancelar.');
  }

  const cleanPrompt = prompt.toLowerCase();
  const matched = schedules.filter(s => {
    const nameMatch = cleanPrompt.includes(s.name.toLowerCase());
    const typeMatch = cleanPrompt.includes(s.report_type.toLowerCase()) || cleanPrompt.includes(reportLabel(s.report_type).toLowerCase());
    return nameMatch || typeMatch;
  });

  if (matched.length === 0) {
    throw new Error('Não consegui identificar qual agendamento você deseja cancelar. Por favor, forneça o nome do relatório ou tipo agendado.');
  }

  if (matched.length > 1) {
    return {
      ambiguous: true,
      matches: matched.map(m => ({ id: m.id, name: m.name })),
      content: 'Encontrei mais de um agendamento correspondente. Escolha qual deseja cancelar:',
    };
  }

  const target = matched[0];
  
  // Deleta de ambos
  await Promise.all([
    supabase.from('report_schedules').delete().eq('id', target.id),
    supabase.from('scheduled_reports').delete().eq('id', target.id),
  ]);

  await supabase.from('ai_system_logs').insert({
    user_id: user.id,
    event: 'report.schedule.cancelled',
    entity: 'scheduled_report',
    entity_id: target.id,
    metadata: { name: target.name },
  });

  return {
    success: true,
    content: `Agendamento "${target.name}" foi cancelado com sucesso.`,
  };
}
