import { parseIntent } from './aiIntentParser';
import { executeAiAction } from './aiActionExecutor';

export async function routeAction(prompt, { user, conversationContext = {} } = {}) {
  const intent = parseIntent(prompt);
  
  // Se for uma pergunta comum de insight, ou a confiança for baixa,
  // deixa o fluxo principal do Chat IA seguir para a resposta baseada em IA generativa (leoAssistant)
  if (intent.action === 'ask_insight' && intent.confidence < 0.6) {
    return null;
  }
  
  intent.rawPrompt = prompt;

  try {
    const result = await executeAiAction(intent, { user, conversationContext });
    return result;
  } catch (error) {
    return {
      content: `Erro ao executar comando operacional: ${error.message || 'tente novamente.'}`,
    };
  }
}
