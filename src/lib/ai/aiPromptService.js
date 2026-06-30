import { fetchAiContext } from './aiContextService';
import { analyzeProductionContext, formatInsightAnswer } from './aiInsightService';
import { normalizeText } from '@/lib/assistant/assistantEngine';
import { recordAiRequest } from './aiAuditService';
import { routeAction } from './aiActionRouter';

function filtersFromQuestion(question) {
  const normalized = normalizeText(question);
  const today = new Date();
  const start = new Date(today);
  const daysMatch = normalized.match(/(?:ultimos?|ha)\s+(\d{1,3})\s+dias?/);
  if (normalized.includes('hoje')) start.setDate(today.getDate());
  else if (normalized.includes('ontem')) {
    start.setDate(today.getDate() - 1);
    today.setDate(today.getDate() - 1);
  } else start.setDate(today.getDate() - (Math.max(1, Number(daysMatch?.[1] || 7)) - 1));

  const cellMatch = question.match(/c[eé]lula\s+([\p{L}0-9._/-]+)/iu);
  const shiftMatch = normalized.match(/(?:turno|shift)\s+([123abc])/);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: today.toISOString().slice(0, 10),
    cells: cellMatch ? [cellMatch[1]] : [],
    shifts: shiftMatch ? [shiftMatch[1]] : [],
  };
}

export function isOperationalAiQuestion(question) {
  const text = normalizeText(question);
  return /\b(relatorio|resumo executivo|comparar celula|desempenho|analise|insight|produtividade|gargalo|ia operacional|copilot|envie|enviar|mande|mandar|agenda|agendar|agendamento|cancele|cancelar|logs)\b/.test(text);
}

export async function askOperationalCopilot(question, { user, conversationContext }) {
  const started = performance.now();
  
  const actionResult = await routeAction(question, { user, conversationContext });
  if (actionResult) {
    await recordAiRequest({
      user,
      requestType: actionResult.pendingAction ? 'question' : 'report',
      prompt: question,
      intent: actionResult.context?.command?.action || 'operational_command',
      filters: actionResult.context?.command?.filters || {},
      responseSummary: actionResult.content,
      durationMs: Math.round(performance.now() - started),
    });
    return actionResult;
  }

  const filters = filtersFromQuestion(question);
  const context = await fetchAiContext(filters, user);
  const analysis = analyzeProductionContext(context);
  const content = formatInsightAnswer(context, analysis);
  await recordAiRequest({
    user,
    requestType: 'insight',
    prompt: question,
    intent: 'production_analysis',
    filters: context.filters,
    responseSummary: content,
    sourceTables: context.sources,
    durationMs: Math.round(performance.now() - started),
  });
  return { content, actions: [{ label: 'Ver análise completa', path: '/ia-operacional' }] };
}
