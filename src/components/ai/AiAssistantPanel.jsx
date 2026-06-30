import { useState } from 'react';
import { Bot, Loader2, Send, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { IndustrialSectionCard } from '@/components/industrial';
import { askLeoAssistant } from '@/lib/assistant/leoAssistant';
import { askOperationalCopilot, isOperationalAiQuestion } from '@/lib/ai/aiPromptService';
import { executeAiAction } from '@/lib/ai/aiActionExecutor';

const initialMessage = {
  role: 'assistant',
  content: 'Sou o Copilot Industrial do Leo Flow. Posso consultar lotes, analisar produção real, explicar indicadores e gerar ou enviar relatórios auditáveis para gestores cadastrados.',
};

export default function AiAssistantPanel({ user }) {
  const [messages, setMessages] = useState([initialMessage]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  
  const [conversationContext, setConversationContext] = useState({
    lastReport: null,
    lastFilters: null,
    lastRecipients: [],
    pendingAction: null,
    lastLotCode: ''
  });

  const ask = async (value = input) => {
    const question = String(value || '').trim();
    if (!question || loading) return;
    setMessages((current) => [...current, { role: 'user', content: question }]);
    setInput('');
    setLoading(true);
    try {
      const answer = isOperationalAiQuestion(question)
        ? await askOperationalCopilot(question, { user, conversationContext })
        : await askLeoAssistant(question, { user, lastLotCode: conversationContext.lastLotCode, currentPath: '/ia-operacional' });
      
      if (answer.context?.lastLotCode) {
        setConversationContext(prev => ({ ...prev, lastLotCode: answer.context.lastLotCode }));
      }
      if (answer.contextPatch) {
        setConversationContext(prev => ({ ...prev, ...answer.contextPatch }));
      }
      if (answer.pendingAction) {
        setConversationContext(prev => ({ ...prev, pendingAction: answer.pendingAction }));
      }
      setMessages((current) => [...current, { role: 'assistant', ...answer }]);
    } catch (error) {
      setMessages((current) => [...current, { role: 'assistant', content: error.message || 'Não foi possível consultar os dados agora.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handlePendingAction = async (actionObj) => {
    if (actionObj.action === 'cancel_pending_action') {
      setConversationContext(prev => ({ ...prev, pendingAction: null }));
      setMessages((current) => [...current, { role: 'assistant', content: 'Ação cancelada.' }]);
      return;
    }

    if (actionObj.action === 'confirm_pending_action') {
      const pending = conversationContext.pendingAction;
      if (!pending) return;

      const payload = { 
        ...pending.payload, 
        ...(actionObj.payloadOverride || {}),
        // Passa flags de confirmação se configuradas nas overrides
        confirmedExternal: pending.payload.confirmedExternal || actionObj.payloadOverride?.confirmedExternal,
        confirmedVolume: pending.payload.confirmedVolume || actionObj.payloadOverride?.confirmedVolume,
        confirmedCancel: pending.payload.confirmedCancel || actionObj.payloadOverride?.confirmedCancel,
      };

      setLoading(true);
      try {
        const answer = await executeAiAction(payload, { user, conversationContext });

        if (answer.contextPatch) {
          setConversationContext(prev => ({ ...prev, ...answer.contextPatch }));
        }
        setConversationContext(prev => ({ ...prev, pendingAction: null }));
        setMessages((current) => [...current, { role: 'assistant', ...answer }]);
      } catch (error) {
        setMessages((current) => [...current, { role: 'assistant', content: error.message || 'Não foi possível executar a ação confirmada.' }]);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <IndustrialSectionCard title="Copilot Industrial" subtitle="Perguntas respondidas com os dados permitidos para o seu perfil." icon={Bot}>
      <div className="h-[min(560px,60vh)] flex flex-col">
        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {messages.map((message, index) => {
            const Icon = message.role === 'assistant' ? Bot : UserRound;
            return (
              <div key={`${message.role}-${index}`} className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${message.role === 'assistant' ? 'bg-[#00522d] text-[#fff200]' : 'bg-secondary text-foreground'}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className={`max-w-[82%] border rounded-md p-3 text-sm whitespace-pre-line ${message.role === 'user' ? 'bg-foreground text-background border-foreground' : 'bg-card border-border'}`}>
                  {message.content}
                  {message.actions?.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {message.actions.map((action, idx) => {
                        if (action.action) {
                          return (
                            <Button
                              key={`act-${idx}`}
                              variant={action.action === 'confirm_pending_action' ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => handlePendingAction(action)}
                              disabled={loading}
                            >
                              {action.label}
                            </Button>
                          );
                        }
                        return (
                          <Button key={action.path} variant="outline" size="sm" asChild>
                            <a href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}${action.path}`}>{action.label}</a>
                          </Button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Consultando registros do Leo Flow...</div>}
        </div>
        <div className="border-t border-border pt-3 mt-3">
          <div className="flex flex-wrap gap-2 mb-3">
            {['Situação do lote LOTE-001', 'Analise os últimos 7 dias', 'Prepare um relatório executivo'].map((prompt) => (
              <Button key={prompt} type="button" variant="outline" size="sm" onClick={() => ask(prompt)} disabled={loading}>
                {prompt}
              </Button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <Textarea 
              value={input} 
              onChange={(event) => setInput(event.target.value)} 
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ask(); } }} 
              placeholder="Pergunte sobre produção, lotes, ocorrências ou relatórios..." 
              className="min-h-20" 
            />
            <Button type="button" size="icon" onClick={() => ask()} disabled={!input.trim() || loading} title="Enviar pergunta">
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </IndustrialSectionCard>
  );
}
