import { fetchAiContext } from './aiContextService';
import { analyzeProductionContext, formatInsightAnswer } from './aiInsightService';
import { normalizeText } from '@/lib/assistant/assistantEngine';
import { recordAiRequest } from './aiAuditService';
import { routeAction } from './aiActionRouter';
import { listAiCapabilities } from './aiCapabilityService';

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
  return /\b(relatorio|resumo executivo|comparar celula|desempenho|analise|insight|produtividade|gargalo|ia operacional|copilot|envie|enviar|mande|mandar|agenda|agendar|agendamento|cancele|cancelar|logs|qualidade|nao conformidade|defeito|pareto|fpy|acao corretiva|parada|downtime|previsao|preditiv\w*|risco|tendencia|etapa|rota produtiva)\b/.test(text);
}

export function classifyOperationalFocus(question) {
  const text = normalizeText(question);
  if (/\b(qualidade|nao conformidade|defeito|pareto|fpy|acao corretiva|5w2h)\b/.test(text)) return 'quality';
  if (/\b(parada|downtime|maquina parada|motivo|causa|gargalo)\b/.test(text)) return 'downtime';
  if (/\b(previsao|preditiv\w*|risco|tendencia|projecao)\b/.test(text)) return 'predictive';
  if (/\b(lote|etapa|rota produtiva|rastreabilidade)\b/.test(text)) return 'lots';
  return 'production';
}

export async function askOperationalCopilot(question, { user, conversationContext }) {
  const started = performance.now();
  const capabilities = await listAiCapabilities(user);
  const enrichedConversationContext = {
    ...(conversationContext || {}),
    capabilities,
  };

  const actionResult = await routeAction(question, { user, conversationContext: enrichedConversationContext });
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
  const focus = classifyOperationalFocus(question);
  const analysis = analyzeProductionContext(context);
  const content = formatInsightAnswer(context, analysis, { focus });
  await recordAiRequest({
    user,
    requestType: 'insight',
    prompt: question,
    intent: `${focus}_analysis`,
    filters: context.filters,
    responseSummary: content,
    sourceTables: context.sources,
    durationMs: Math.round(performance.now() - started),
  });
  return {
    content,
    actions: [{ label: 'Ver análise completa', path: '/ia-operacional' }],
    context: { capabilities },
  };
}
