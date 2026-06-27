import {
  buildInsightsAnswer,
  buildLotAnswer,
  classifyAssistantIntent,
  extractLotSearch,
  findNavigationTopic,
  NAVIGATION_TOPICS,
  canAccessTopic,
  normalizeText,
} from './assistantEngine';
import { fetchLotSnapshot, fetchProductionSnapshot } from './assistantData';
import { askOperationalCopilot, isOperationalAiQuestion } from '@/lib/ai/aiPromptService';
import { answerProductionQuestion, isProductionSearchQuestion } from '@/lib/ai/aiProductionSearchService';

function navigationResponse(topic) {
  return {
    content: `Use a tela “${topic.label}” para ${topic.description}. Posso abrir essa área para você.`,
    actions: [{ label: `Abrir ${topic.label}`, path: topic.path }],
  };
}

export async function askLeoAssistant(question, context = {}) {
  const { user, lastLotCode, currentPath } = context;
  if (isProductionSearchQuestion(question)) {
    return answerProductionQuestion(question, { user });
  }
  if (isOperationalAiQuestion(question)) {
    return askOperationalCopilot(question, { user });
  }
  const intent = classifyAssistantIntent(question, { lastLotCode });

  if (intent === 'lot_missing_code') {
    return {
      content: 'Informe o código do lote ou do pedido. Exemplo: “Qual a situação do lote LOTE-123?”',
      actions: [{ label: 'Abrir Rastreabilidade', path: '/rastreabilidade' }],
    };
  }

  if (intent === 'lot') {
    const search = extractLotSearch(question) || lastLotCode;
    const snapshot = await fetchLotSnapshot(search);
    if (!snapshot.matches.length) {
      return {
        content: `Não encontrei lote ou pedido correspondente a “${search}”. Confira o código e tente novamente.`,
        actions: [{ label: 'Buscar em Rastreabilidade', path: '/rastreabilidade' }],
      };
    }
    if (snapshot.matches.length > 1) {
      return {
        content: `Encontrei ${snapshot.matches.length} lotes. Informe um código mais completo:\n${snapshot.matches.map((lot) => `• ${lot.lot_code} · ${lot.production_orders?.order_code || 'pedido sem código'}`).join('\n')}`,
        actions: [{ label: 'Abrir Rastreabilidade', path: '/rastreabilidade' }],
      };
    }

    return {
      content: buildLotAnswer(snapshot),
      actions: [{ label: 'Abrir Rastreabilidade', path: '/rastreabilidade' }],
      context: { lastLotCode: snapshot.lot.lot_code },
    };
  }

  if (intent === 'insights') {
    const snapshot = await fetchProductionSnapshot();
    return {
      content: buildInsightsAnswer(snapshot),
      actions: [
        { label: 'Abrir Painéis', path: '/painel' },
        { label: 'Ver Ocorrências', path: '/ocorrencias' },
      ],
    };
  }

  if (intent === 'greeting') {
    return {
      content: 'Olá! Posso localizar lotes, explicar a situação completa da rota, analisar produtividade e levar você até a tela correta. O que deseja consultar?',
      suggestions: ['Situação de um lote', 'Insights dos últimos 7 dias', 'Como registrar produção?'],
    };
  }

  if (intent === 'thanks') {
    return { content: 'Por nada. Quando precisar, posso continuar acompanhando lotes e indicadores com você.' };
  }

  const normalized = normalizeText(question);

  if (/\boee\b/.test(normalized)) {
    return {
      content: 'O OEE mede a efetividade do processo combinando disponibilidade, performance e qualidade. No Leo Flow, ele ajuda a identificar se a perda vem de parada, ritmo abaixo do esperado ou refugo.',
      actions: [{ label: 'Abrir OEE', path: '/oee' }],
    };
  }

  if (/\beficiencia\b/.test(normalized)) {
    return {
      content: 'A eficiência compara o total produzido com a meta do período. Quando ela cai, cruze o resultado com paradas, refugo, célula e turno para encontrar a causa.',
      actions: [{ label: 'Abrir Painéis', path: '/painel' }],
    };
  }

  if (/\b(rastreabilidade|rota do lote)\b/.test(normalized)) {
    return {
      content: 'A rastreabilidade acompanha o lote desde a importação do Promob até corte, bordo, usinagem, marcenaria, separação, embalagem e expedição. Cada movimentação registrada forma o histórico consultado pelo assistente.',
      actions: [{ label: 'Abrir Rastreabilidade', path: '/rastreabilidade' }],
    };
  }

  if (/\bpromob\b/.test(normalized)) {
    return {
      content: 'A Integração Promob transforma pedidos importados em ordens, lotes e itens rastreáveis. Nessa área você acompanha configuração, importação e diferenças encontradas.',
      actions: [{ label: 'Abrir Integração Promob', path: '/integracoes/promob' }],
    };
  }

  if (/onde (estou|fica essa tela)|qual (tela|pagina) estou/.test(normalized)) {
    const current = NAVIGATION_TOPICS.find((topic) => topic.path === currentPath && canAccessTopic(topic, user));
    if (current) return { content: `Você está em “${current.label}”, área usada para ${current.description}.` };
  }

  const topic = findNavigationTopic(question, user);
  if (topic) return navigationResponse(topic);

  if (/o que (voce|vc) (faz|pode fazer)|como (voce|vc) ajuda|suas funcoes/.test(normalized)) {
    return {
      content: 'Posso consultar a situação completa de lotes e pedidos, mostrar etapas percorridas e pendentes, verificar embalagem e expedição, gerar insights produtivos e orientar a navegação pelo sistema.',
      suggestions: ['Localizar um lote', 'Gerar insights produtivos', 'Onde vejo os relatórios?'],
    };
  }

  return {
    content: 'Consigo ajudar com lotes, produção, metas, OEE, ocorrências, relatórios, Promob e navegação do sistema. Tente perguntar “qual a situação do lote ...?” ou “me dê insights produtivos”.',
    suggestions: ['Localizar um lote', 'Insights dos últimos 7 dias', 'Onde registro produção?'],
  };
}
