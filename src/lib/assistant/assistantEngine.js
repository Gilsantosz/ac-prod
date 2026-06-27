const STAGES = [
  ['imported', 'Importado'],
  ['released', 'Liberado'],
  ['cut', 'Corte'],
  ['edge', 'Bordo'],
  ['cnc', 'Usinagem'],
  ['joinery', 'Marcenaria'],
  ['separation', 'Separação'],
  ['packaging', 'Embalagem'],
  ['waiting_shipping', 'Aguardando envio'],
  ['shipping', 'Expedição'],
  ['completed', 'Finalizado'],
];

const STAGE_LABELS = Object.fromEntries(STAGES);

const STATUS_LABELS = {
  planned: 'Planejado',
  released: 'Liberado',
  in_progress: 'Em produção',
  blocked: 'Bloqueado',
  partial: 'Parcial',
  ready_to_pack: 'Pronto para embalar',
  packed: 'Embalado',
  waiting_shipping: 'Aguardando expedição',
  shipped: 'Expedido',
  cancelled: 'Cancelado',
};

const EVENT_LABELS = {
  start: 'início',
  finish: 'conclusão',
  pause: 'pausa',
  block: 'bloqueio',
  unblock: 'desbloqueio',
  rework: 'retrabalho',
  scrap: 'refugo',
  missing: 'falta',
  found: 'localizado',
  undo: 'estorno',
  transfer: 'transferência',
  note: 'observação',
};

export const NAVIGATION_TOPICS = [
  { path: '/', label: 'Painéis', description: 'indicadores gerais, produtividade e alertas', keywords: ['painel', 'dashboard', 'indicador', 'produtividade', 'inicio'], permission: 'view_dashboards' },
  { path: '/entrada', label: 'Entrada de Produção', description: 'registrar produção, refugo e horas trabalhadas', keywords: ['entrada', 'lancar producao', 'registrar producao', 'registro producao', 'apontar producao', 'apontamento'], permission: 'register_production' },
  { path: '/resumo-diario', label: 'Resumo Diário', description: 'consultar o fechamento diário por célula e turno', keywords: ['resumo', 'fechamento diario', 'producao do dia'], permission: 'view_dashboards' },
  { path: '/oee', label: 'OEE', description: 'acompanhar disponibilidade, performance e qualidade', keywords: ['oee', 'disponibilidade', 'performance', 'qualidade'], permission: 'view_dashboards' },
  { path: '/celulas-metas', label: 'Células e Metas', description: 'configurar células, turnos e metas produtivas', keywords: ['celula', 'meta', 'turno', 'configurar meta'], permission: 'manage_cells' },
  { path: '/usuarios?tab=operators', label: 'Operadores', description: 'consultar e gerenciar operadores dentro de Usuários', keywords: ['operador', 'colaborador da producao'], permission: 'manage_operators' },
  { path: '/rastreabilidade', label: 'Rastreabilidade', description: 'localizar lotes e acompanhar rota, embalagem e expedição', keywords: ['rastreabilidade', 'lote', 'rota', 'marcenaria', 'embalagem', 'expedicao'] },
  { path: '/integracoes/promob', label: 'Integração Promob', description: 'importar pedidos e acompanhar sincronizações do Promob', keywords: ['promob', 'xml', 'integracao', 'sincronizacao'] },
  { path: '/ocorrencias', label: 'Ocorrências', description: 'registrar e analisar paradas, falhas e motivos', keywords: ['ocorrencia', 'parada', 'falha', 'gargalo'], permission: 'manage_occurrences' },
  { path: '/gamificacao', label: 'Gamificação', description: 'consultar ranking e desempenho das equipes', keywords: ['gamificacao', 'ranking', 'premiacao'], permission: 'view_dashboards' },
  { path: '/relatorios', label: 'Relatórios', description: 'analisar e exportar relatórios industriais', keywords: ['relatorio', 'exportar', 'pdf', 'excel', 'csv'], permission: 'view_reports' },
  { path: '/ia-operacional', label: 'IA Operacional', description: 'consultar o Copilot Industrial, gerar, enviar e agendar relatórios', keywords: ['ia operacional', 'copilot', 'relatorio por email', 'agendar relatorio'], permission: 'view_reports' },
  { path: '/automacoes', label: 'Automações', description: 'configurar regras e alertas automáticos', keywords: ['automacao', 'alerta automatico', 'regra'], permission: 'manage_automations' },
  { path: '/usuarios', label: 'Usuários', description: 'gerenciar usuários, permissões e relatórios automáticos', keywords: ['usuario', 'permissao', 'acesso'], adminOnly: true },
  { path: '/logs-sistema', label: 'Logs do Sistema', description: 'consultar o histórico de alterações e auditoria', keywords: ['log', 'auditoria', 'alteracao'], adminOnly: true },
  { path: '/downloads-backups?tab=drive', label: 'Backups & Drive', description: 'gerenciar arquivos, cópias de segurança e arquivamento no Google Drive', keywords: ['download', 'backup', 'copia de seguranca', 'google drive', 'drive', 'arquivar'], adminOnly: true },
];

export function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s._/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function canAccessTopic(topic, user) {
  if (user?.role === 'admin') return true;
  if (topic.adminOnly) return false;
  if (!topic.permission) return true;
  return !!user?.permissions?.[topic.permission];
}

export function findNavigationTopic(question, user) {
  const normalized = normalizeText(question);
  let best = null;
  let bestScore = 0;

  for (const topic of NAVIGATION_TOPICS) {
    if (!canAccessTopic(topic, user)) continue;
    const score = topic.keywords.reduce((total, keyword) => {
      const key = normalizeText(keyword);
      return total + (normalized.includes(key) ? Math.max(2, key.split(' ').length * 2) : 0);
    }, 0);
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }

  return bestScore >= 2 ? best : null;
}

export function classifyAssistantIntent(question, { lastLotCode } = {}) {
  const normalized = normalizeText(question);
  const hasLotTerm = /\b(lote|pedido|rota|embalad\w*|expedid\w*|finalizad\w*|encerrad\w*|bloquead\w*|passou|falta passar)\b/.test(normalized);
  const hasInsightTerm = /\b(insight\w*|sugest\w*|analise\w*|desempenho|eficiencia|produtiv\w*|gargalo\w*|meta\w*|refugo\w*|parada\w*)\b/.test(normalized);
  const isGreeting = /^(oi|ola|bom dia|boa tarde|boa noite|hey|ajuda)\b/.test(normalized);
  const isThanks = /^(obrigad|valeu|perfeito|entendi)/.test(normalized);
  const isExplanation = /^(o que e|como funciona|explique|qual a diferenca|para que serve)\b/.test(normalized);

  if (isExplanation) return 'knowledge';
  if (hasLotTerm && (extractLotSearch(question) || lastLotCode)) return 'lot';
  if (hasLotTerm && normalized.includes('lote')) return 'lot_missing_code';
  if (hasInsightTerm) return 'insights';
  if (isGreeting) return 'greeting';
  if (isThanks) return 'thanks';
  return 'knowledge';
}

export function extractLotSearch(question = '') {
  const afterLot = String(question).match(/\b(?:lote|pedido)\s*(?:n[ºo°.]*)?\s*[:#-]?\s*([a-z0-9][a-z0-9._/-]{2,})/i);
  if (afterLot?.[1]) return afterLot[1].replace(/[.,;!?]+$/, '');

  const candidates = String(question).match(/[a-z0-9]+(?:[-/._][a-z0-9]+){1,}/gi) || [];
  return candidates.sort((a, b) => b.length - a.length)[0] || '';
}

function formatDate(value, includeTime = false) {
  if (!value) return 'não informado';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(value));
  const date = new Date(dateOnly ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('pt-BR', includeTime
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { dateStyle: 'short' }).format(date);
}

function requiredStages(items = []) {
  const any = (field) => items.some((item) => item[field] !== false);
  const stages = ['imported', 'released'];
  if (any('requires_cut')) stages.push('cut');
  if (items.some((item) => item.requires_edge)) stages.push('edge');
  if (items.some((item) => item.requires_cnc)) stages.push('cnc');
  if (items.some((item) => item.requires_joinery)) stages.push('joinery');
  if (any('requires_separation')) stages.push('separation');
  if (any('requires_packaging')) stages.push('packaging');
  if (any('requires_shipping')) stages.push('waiting_shipping', 'shipping');
  stages.push('completed');
  return [...new Set(stages)];
}

export function buildLotAnswer(snapshot) {
  const { lot, events = [], packages = [], shipments = [] } = snapshot;
  const order = lot.production_orders || {};
  const items = lot.lot_items || [];
  const route = requiredStages(items);
  const currentIndex = route.indexOf(lot.current_stage);
  const remaining = currentIndex >= 0 ? route.slice(currentIndex + 1) : route;
  const quantity = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const passed = [...new Set(events.map((event) => event.step_code).filter((code) => STAGE_LABELS[code]))];
  const lastEvent = events[events.length - 1];
  const closedPackages = packages.filter((pkg) => ['closed', 'waiting_shipping', 'shipped'].includes(pkg.status));
  const shipped = lot.status === 'shipped' || shipments.some((shipment) => shipment.status === 'shipped' || shipment.shipped_at);
  const completed = lot.current_stage === 'completed' || !!lot.actual_end;
  const isLate = order.delivery_date && new Date(order.delivery_date) < new Date() && !completed;

  const lines = [
    `Lote ${lot.lot_code}`,
    `Situação: ${STATUS_LABELS[lot.status] || lot.status || 'Não informada'} · Etapa atual: ${STAGE_LABELS[lot.current_stage] || lot.current_stage || 'Não informada'} · Progresso: ${Number(lot.progress_percent || 0).toLocaleString('pt-BR')}%`,
    `Pedido: ${order.order_code || 'não informado'} · Cliente: ${order.customer_name || 'não informado'} · Entrega: ${formatDate(order.delivery_date)}${isLate ? ' (em atraso)' : ''}`,
    `Conteúdo: ${items.length} item(ns), ${quantity} peça(s) · Faltas: ${lot.missing_count || 0} · Retrabalhos: ${lot.rework_count || 0} · Refugos: ${lot.scrap_count || 0}`,
  ];

  if (lot.status === 'blocked') {
    lines.push(`Bloqueio: ${lot.blocked_reason || 'motivo não registrado'}`);
  }

  lines.push(
    passed.length
      ? `Etapas registradas: ${passed.map((code) => STAGE_LABELS[code]).join(' → ')}`
      : 'Etapas registradas: ainda não há movimentações detalhadas no histórico.',
    remaining.length
      ? `Ainda falta passar por: ${remaining.map((code) => STAGE_LABELS[code]).join(' → ')}`
      : 'Rota produtiva concluída.',
  );

  if (lastEvent) {
    lines.push(`Último registro: ${STAGE_LABELS[lastEvent.step_code] || lastEvent.step_code}, ${EVENT_LABELS[lastEvent.event_type] || lastEvent.event_type}, em ${formatDate(lastEvent.created_at, true)}${lastEvent.notes ? ` · ${lastEvent.notes}` : ''}`);
  }

  if (packages.length) {
    lines.push(`Embalagem: ${closedPackages.length}/${packages.length} volume(s) fechado(s)${packages.some((pkg) => pkg.status === 'shipped') ? ' e expedido(s)' : ''}.`);
  } else {
    lines.push('Embalagem: nenhum volume registrado para este lote.');
  }

  if (shipments.length) {
    const latestShipment = shipments[0];
    lines.push(`Expedição: ${shipped ? 'expedida' : 'pendente'} · ${latestShipment.shipment_code || 'sem código'}${latestShipment.tracking_code ? ` · rastreio ${latestShipment.tracking_code}` : ''}.`);
  } else {
    lines.push(`Expedição: ${shipped ? 'marcada como expedida no lote' : 'ainda não registrada'}.`);
  }

  lines.push(`Encerramento: ${completed ? `concluído em ${formatDate(lot.actual_end, true)}` : 'lote ainda aberto'}.`);
  return lines.join('\n');
}

function percentage(value) {
  return `${Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

export function buildInsightsAnswer(snapshot) {
  const { entries = [], occurrences = [], lots = [], periodStart, periodEnd } = snapshot;
  if (!entries.length && !lots.length) {
    return 'Ainda não há dados recentes suficientes para gerar uma análise produtiva. Registre produção ou importe lotes e tente novamente.';
  }

  const total = entries.reduce((acc, entry) => {
    acc.produced += Number(entry.produced) || 0;
    acc.target += Number(entry.target) || 0;
    acc.scrap += Number(entry.scrap) || 0;
    acc.downtime += Number(entry.downtime) || 0;
    return acc;
  }, { produced: 0, target: 0, scrap: 0, downtime: 0 });

  const efficiency = total.target ? (total.produced / total.target) * 100 : 0;
  const scrapRate = total.produced ? (total.scrap / total.produced) * 100 : 0;
  const byCell = {};
  for (const entry of entries) {
    const key = entry.cell || 'Sem célula';
    byCell[key] ||= { produced: 0, target: 0, downtime: 0 };
    byCell[key].produced += Number(entry.produced) || 0;
    byCell[key].target += Number(entry.target) || 0;
    byCell[key].downtime += Number(entry.downtime) || 0;
  }
  const cellRanking = Object.entries(byCell)
    .map(([cell, data]) => ({ cell, ...data, efficiency: data.target ? (data.produced / data.target) * 100 : 0 }))
    .filter((item) => item.target > 0)
    .sort((a, b) => a.efficiency - b.efficiency);

  const reasonTotals = {};
  for (const occurrence of occurrences) {
    const reason = occurrence.reason || 'Sem motivo';
    reasonTotals[reason] = (reasonTotals[reason] || 0) + (Number(occurrence.downtime) || 0);
  }
  const topReason = Object.entries(reasonTotals).sort((a, b) => b[1] - a[1])[0];
  const blocked = lots.filter((lot) => lot.status === 'blocked');
  const late = lots.filter((lot) => lot.production_orders?.delivery_date && new Date(lot.production_orders.delivery_date) < new Date() && lot.current_stage !== 'completed');

  const suggestions = [];
  if (cellRanking[0]?.efficiency < 80) suggestions.push(`Priorize a célula ${cellRanking[0].cell}, com ${percentage(cellRanking[0].efficiency)} de eficiência no período.`);
  else if (efficiency >= 95) suggestions.push('A eficiência está forte; preserve o padrão operacional e verifique se as metas continuam desafiadoras.');
  if (scrapRate > 3) suggestions.push(`Revise setup, material e qualidade: o refugo está em ${percentage(scrapRate)}.`);
  if (topReason) suggestions.push(`Ataque primeiro “${topReason[0]}”, principal motivo de parada (${Number(topReason[1]).toLocaleString('pt-BR')} min).`);
  if (blocked.length) suggestions.push(`Há ${blocked.length} lote(s) bloqueado(s); comece pelo mais antigo para liberar o fluxo.`);
  if (late.length) suggestions.push(`${late.length} lote(s) estão com entrega vencida; revise prioridade e capacidade das próximas etapas.`);
  if (!suggestions.length) suggestions.push('O fluxo está estável. Continue acompanhando eficiência, refugo e paradas por célula.');

  return [
    `Leitura produtiva de ${formatDate(periodStart)} a ${formatDate(periodEnd)}`,
    `Produzido: ${total.produced.toLocaleString('pt-BR')} · Meta: ${total.target.toLocaleString('pt-BR')} · Eficiência: ${percentage(efficiency)}`,
    `Refugo: ${total.scrap.toLocaleString('pt-BR')} (${percentage(scrapRate)}) · Paradas: ${total.downtime.toLocaleString('pt-BR')} min`,
    `Fluxo: ${blocked.length} bloqueado(s) · ${late.length} em atraso · ${lots.filter((lot) => lot.current_stage === 'completed').length} finalizado(s)`,
    '',
    'Sugestões:',
    ...suggestions.slice(0, 4).map((suggestion) => `• ${suggestion}`),
  ].join('\n');
}
