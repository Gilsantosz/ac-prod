import { fetchAiContext } from './aiContextService';
import { analyzeProductionContext, formatInsightAnswer } from './aiInsightService';
import { normalizeText } from '@/lib/assistant/assistantEngine';
import { recordAiRequest } from './aiAuditService';

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
  return /\b(relatorio|resumo executivo|comparar celula|desempenho|analise|insight|produtividade|gargalo|ia operacional|copilot)\b/.test(text);
}

export async function askOperationalCopilot(question, { user }) {
  const started = performance.now();
  const normalized = normalizeText(question);
  if (/\b(relatorio|pdf|excel|csv|enviar por email|agendar)\b/.test(normalized)) {
    const content = 'Posso montar, exportar, enviar e agendar esse relatório na área IA Operacional. Os filtros e destinatários ficam registrados para auditoria.';
    await recordAiRequest({ user, requestType: 'navigation', prompt: question, intent: 'report_request', responseSummary: content, sourceTables: [], durationMs: Math.round(performance.now() - started) });
    return { content, actions: [{ label: 'Abrir IA Operacional', path: '/ia-operacional' }] };
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
