import { normalizeText } from '@/lib/assistant/assistantEngine';

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const REPORT_SYNONYMS = {
  oee: 'oee',
  producao: 'production_summary',
  'resumo de producao': 'production_summary',
  'resumo diario': 'daily_production',
  'resumo diario de producao': 'daily_production',
  'fechamento de turno': 'shift_closure',
  'fechamento do turno': 'shift_closure',
  'desempenho por celula': 'cell_performance',
  desempenho: 'cell_performance',
  celula: 'cell_performance',
  rastreabilidade: 'lot_traceability',
  lote: 'lot_traceability',
  rota: 'lot_traceability',
  ocorrencias: 'occurrences',
  paradas: 'occurrences',
  falhas: 'occurrences',
  'resumo executivo': 'executive',
  executivo: 'executive',
  'lotes atrasados': 'lots_delayed',
  atrasos: 'lots_delayed',
  'embalagem pendente': 'packaging_pending',
  'expedicao pendente': 'shipping_pending',
  'pendente embalagem': 'packaging_pending',
  'pendente expedicao': 'shipping_pending',
};

function localIso(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function parseBrazilianDate(value) {
  const match = String(value || '').match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return '';
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const date = new Date(year, Number(match[2]) - 1, Number(match[1]));
  return Number.isNaN(date.getTime()) ? '' : localIso(date);
}

function resolvePeriod(normalized, now = new Date(), reportType = 'production_summary') {
  const explicitRange = normalized.match(/(?:de|entre)\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+(?:a|e|ate)\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/);
  if (explicitRange) {
    const startDate = parseBrazilianDate(explicitRange[1]);
    const endDate = parseBrazilianDate(explicitRange[2]);
    if (startDate && endDate) return { startDate, endDate };
  }

  const explicitDate = normalized.match(/\b(?:dia|data|em)\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/);
  if (explicitDate) {
    const date = parseBrazilianDate(explicitDate[1]);
    if (date) return { startDate: date, endDate: date };
  }

  const dayOfMonth = normalized.match(/\bdia\s+(\d{1,2})\b/);
  if (dayOfMonth) {
    const day = Number(dayOfMonth[1]);
    const date = new Date(now.getFullYear(), now.getMonth(), day);
    if (day >= 1 && day <= 31 && date.getMonth() === now.getMonth()) {
      return { startDate: localIso(date), endDate: localIso(date) };
    }
  }

  if (/\bontem\b/.test(normalized)) {
    const yesterday = localIso(addDays(now, -1));
    return { startDate: yesterday, endDate: yesterday };
  }
  if (/\bhoje\b/.test(normalized)) {
    const today = localIso(now);
    return { startDate: today, endDate: today };
  }
  const daysMatch = normalized.match(/(?:ultimos?|ha)\s+(\d{1,3})\s+dias?/);
  if (daysMatch) {
    const days = Math.max(1, Math.min(366, Number(daysMatch[1])));
    return { startDate: localIso(addDays(now, -(days - 1))), endDate: localIso(now) };
  }
  if (/\b(esta|nesta)\s+semana\b/.test(normalized)) {
    const weekday = now.getDay() || 7;
    return { startDate: localIso(addDays(now, 1 - weekday)), endDate: localIso(now) };
  }
  if (/\b(passada|anterior)\s+semana\b|\bsemana\s+(passada|anterior)\b/.test(normalized)) {
    const weekday = now.getDay() || 7;
    const end = addDays(now, -weekday);
    const start = addDays(end, -6);
    return { startDate: localIso(start), endDate: localIso(end) };
  }
  if (/\b(este|neste)\s+mes\b/.test(normalized)) {
    return { startDate: localIso(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: localIso(now) };
  }
  if (/\b(passado|anterior)\s+mes\b|\bmes\s+(passado|anterior)\b/.test(normalized)) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { startDate: localIso(start), endDate: localIso(end) };
  }

  // Fallback default
  const endDate = localIso(now);
  return reportType === 'oee'
    ? { startDate: endDate, endDate }
    : { startDate: localIso(addDays(now, -6)), endDate };
}

export function parseIntent(prompt, options = {}) {
  const text = String(prompt || '').trim();
  const normalized = normalizeText(text);
  const now = options.now || new Date();

  // 1. Extração de e-mails diretos
  const directEmails = text.match(EMAIL_PATTERN) || [];

  // 2. Extração do tipo de relatório (ordenação decrescente de tamanho dos sinônimos para maior precisão)
  let reportType = null;
  const sortedSynonyms = Object.entries(REPORT_SYNONYMS).sort((a, b) => b[0].length - a[0].length);
  for (const [key, val] of sortedSynonyms) {
    const regex = new RegExp(`\\b${key}\\b`, 'i');
    if (regex.test(normalized)) {
      reportType = val;
      break;
    }
  }

  // 3. Extração do período / datas
  const period = resolvePeriod(normalized, now, reportType || 'production_summary');

  // 4. Extração de filtros específicos
  const cellMatch = normalized.match(/\bc[eé]lula\s+([\p{L}0-9._/-]+)/iu) || normalized.match(/\bde\s+c[eé]lula\s+([\p{L}0-9._/-]+)/iu);
  const cell = cellMatch ? cellMatch[1].trim() : null;

  const shiftMatch = normalized.match(/\bturno\s+([123abc])/i) || normalized.match(/\b([123]º?)\s+turno/i);
  let shift = 'all';
  if (shiftMatch) {
    const s = shiftMatch[1].replace('º', '');
    shift = ['1','2','3'].includes(s) ? `${s}º Turno` : s;
  }

  const lotMatch = text.match(/\blote\s+([A-Z0-9-]+)/i);
  const lotCode = lotMatch ? lotMatch[1].trim() : null;

  const orderMatch = text.match(/\bpedido\s+(\d+)/i);
  const orderNumber = orderMatch ? orderMatch[1].trim() : null;

  const loadMatch = text.match(/\bcarga\s+(\d+)/i);
  const loadNumber = loadMatch ? loadMatch[1].trim() : null;

  const customerMatch = text.match(/\bcliente\s+([\p{L}0-9._/-]+)/iu);
  const customerName = customerMatch ? customerMatch[1].trim() : null;

  const envMatch = text.match(/\bambiente\s+([\p{L}0-9._/-]+)/iu);
  const environmentName = envMatch ? envMatch[1].trim() : null;

  const filters = {
    startDate: period?.startDate || null,
    endDate: period?.endDate || null,
    cell,
    shift,
    lotCode,
    orderNumber,
    loadNumber,
    customerName,
    environmentName,
  };

  // 5. Extração de agendamentos
  let schedule = null;
  const isSchedule = /\b(agende|agendar|agendamento|agenda)\b/.test(normalized) || /\b(todo\s+dia|diariamente|dias\s+uteis|toda\s+(segunda|terca|quarta|quinta|sexta|sabado)|todo\s+domingo)\b/.test(normalized);
  
  if (isSchedule) {
    let frequency = 'daily';
    if (/\bdias\s+uteis\b/.test(normalized)) {
      frequency = 'workdays';
    } else if (/\btoda\s+segunda\b|\bsemanalmente\b/.test(normalized)) {
      frequency = 'weekly';
    } else if (/\bmensalmente\b/.test(normalized)) {
      frequency = 'monthly';
    }

    let timeLocal = '07:00';
    const timeMatch = text.match(/(?:^|\s)[aàá]s\s+(\d{1,2})(?::(\d{2}))?\s*h?\b/i);
    if (timeMatch) {
      const hour = String(timeMatch[1]).padStart(2, '0');
      const min = String(timeMatch[2] || '00').padStart(2, '0');
      timeLocal = `${hour}:${min}`;
    }

    schedule = {
      frequency,
      timeLocal,
      timezone: 'America/Sao_Paulo',
    };
  }

  // 6. Extração de destinatários (excluindo e-mails já extraídos)
  const recipients = [...directEmails];
  if (/\b(para\s+mim|para\s+meu\s+e-?mail|meu\s+e-?mail|remetente|solicitante|usuario\s+atual|usu[aá]rio\s+atual)\b/.test(normalized)
    || /\b(me\s+envie|envie-?\s?me|me\s+mande|mande-?\s?me)\b/.test(normalized)) {
    recipients.push('remetente');
  }
  const toMatch = text.match(/\bpara\s+(?:o\s+|a\s+)?(?:gestor(?:a)?|gerente|administrador(?:a)?|diretoria|gerencia)?\s*([\p{L}][\p{L}\s.'-]{1,80}?)(?=\s+(?:por|via|as|todo|toda|diariamente|dias|mensalmente)\b|[,.!?]|$)/iu);
  if (toMatch) {
    const name = toMatch[1].trim().replace(/\s+/g, ' ');
    if (name && !recipients.includes(name) && !['email', 'html', 'pdf', 'csv', 'xlsx', 'excel'].includes(name.toLowerCase())) {
      recipients.push(name);
    }
  }
  
  if (/\btodos\s+os\s+gestores\b|\bgerencia\b|\bdiretoria\b/.test(normalized)) {
    if (!recipients.includes('todos os gestores')) {
      recipients.push('todos os gestores');
    }
  }

  // 7. Formato do arquivo
  let format = 'pdf';
  if (/\bcsv\b/.test(normalized)) format = 'csv';
  else if (/\bxlsx\b|\bexcel\b/.test(normalized)) format = 'xlsx';
  else if (/\bhtml\b|\bno\s+corpo\b/.test(normalized)) format = 'email_html';

  // 8. Classificação de Intenção
  let action = 'ask_insight';
  let confidence = 0.5;

  if (/\b(quais|listar|mostrar)\b.*\b(agendados?|agendas?|agendamentos?)\b/i.test(normalized) || /\bagendamentos\b/.test(normalized)) {
    action = 'list_schedules';
    confidence = 0.9;
  } else if (/\b(cancele|cancelar|remover|excluir)\b.*\b(agendamento|agenda)\b/i.test(normalized) || /\bcancelar\s+agenda\b/.test(normalized)) {
    action = 'cancel_schedule';
    confidence = 0.9;
  } else if (/\b(altere|alterar|editar|mudar)\b.*\b(agendamento|agenda)\b/i.test(normalized)) {
    action = 'edit_schedule';
    confidence = 0.9;
  } else if (/\b(mostre|listar|ver)\b.*\b(envios|logs?)\b/i.test(normalized) || /\blogs?\s+de\s+envios?\b|\blogs?\s+de\s+e-?mail\b/.test(normalized)) {
    action = 'show_email_logs';
    confidence = 0.9;
  } else if (/\blogs?\s+da?\s+ia\b|\blogs?\s+de\s+sistema\b/.test(normalized)) {
    action = 'show_ai_logs';
    confidence = 0.9;
  } else if (/\b(abra|ir\s+para|navegue\s+para|navegar)\s+a\s+tela\b/.test(normalized)) {
    action = 'navigate';
    confidence = 0.9;
  } else if (/\b(procure|buscar|cade|onde\s+esta)\s+(o\s+)?(?:lote|pedido|carga|cliente|peça)\b/.test(normalized) || lotCode || orderNumber || loadNumber) {
    action = 'search_production';
    confidence = 0.8;
  } else if (schedule) {
    action = 'schedule_report_email';
    confidence = 0.85;
  } else if (/\b(envie|enviar|mande|mandar|encaminhar|dispare|disparar)\b/.test(normalized)) {
    action = 'send_report_email';
    confidence = 0.85;
  } else if (/\b(gere|gerar|crie|criar)\b/.test(normalized) && reportType) {
    action = 'generate_report';
    confidence = 0.8;
  } else if (/\b(relatorio|pdf|excel|csv|enviar por email|agendar)\b/.test(normalized)) {
    action = 'generate_report';
    confidence = 0.7;
  }

  // Detect missing fields
  const missingFields = [];
  if (['send_report_email', 'schedule_report_email', 'generate_report'].includes(action)) {
    if (!reportType) missingFields.push('reportType');
    if (!period && action !== 'schedule_report_email') missingFields.push('period');
    if (action === 'send_report_email' && recipients.length === 0) missingFields.push('recipients');
  }

  return {
    action,
    reportType,
    recipients,
    filters,
    schedule,
    format,
    templateCode: reportType === 'cell_performance' ? 'cell-performance' : 'manager-summary',
    subject: null,
    message: null,
    confidence,
    missingFields,
  };
}
