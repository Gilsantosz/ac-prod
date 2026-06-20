import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bot, Eraser, MessageCircle, Send, Sparkles, X } from 'lucide-react';
import LeoLogo from '@/components/ui/LeoLogo';
import { askLeoAssistant } from '@/lib/assistant/leoAssistant';
import { cn } from '@/lib/utils';

const WELCOME = {
  id: 'welcome',
  role: 'assistant',
  content: 'Olá! Sou o Copilot Industrial. Posso consultar lotes, analisar a produção real, preparar relatórios e ajudar você a navegar pelo sistema.',
  suggestions: ['Localizar um lote', 'Insights dos últimos 7 dias', 'Como registrar produção?'],
};

const QUICK_PROMPTS = ['Localizar um lote', 'Insights produtivos', 'Ajuda para navegar'];

function storageKey(user) {
  return `leo-assistant-chat:${user?.id || user?.email || 'session'}`;
}

function loadMessages(user) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(user)) || '[]');
    return Array.isArray(parsed) && parsed.length ? parsed.slice(-24) : [WELCOME];
  } catch {
    return [WELCOME];
  }
}

export default function LeoAssistantChat({ user }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState(() => loadMessages(user));
  const [lastLotCode, setLastLotCode] = useState('');
  const endRef = useRef(null);

  const persistedMessages = useMemo(() => messages.slice(-24), [messages]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(user), JSON.stringify(persistedMessages));
    } catch {
      // A conversa continua na sessão mesmo se o armazenamento estiver indisponível.
    }
  }, [persistedMessages, user]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading, open]);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const clearConversation = () => {
    setMessages([WELCOME]);
    setLastLotCode('');
  };

  const sendQuestion = async (value = input) => {
    const question = String(value || '').trim();
    if (!question || loading) return;

    const userMessage = { id: `user-${Date.now()}`, role: 'user', content: question };
    setMessages((current) => [...current, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const answer = await askLeoAssistant(question, {
        user,
        lastLotCode,
        currentPath: location.pathname,
      });
      if (answer.context?.lastLotCode) setLastLotCode(answer.context.lastLotCode);
      setMessages((current) => [
        ...current,
        { id: `assistant-${Date.now()}`, role: 'assistant', ...answer },
      ]);
    } catch (error) {
      console.error('[Assistente Leo] Falha ao responder:', error);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: 'assistant',
          content: 'Não consegui consultar os dados agora. Verifique sua conexão e sua permissão de acesso, depois tente novamente.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const goTo = (path) => {
    navigate(path);
    setOpen(false);
  };

  return (
    <div className="fixed bottom-4 right-3 sm:right-5 z-[70] pointer-events-none">
      {open && (
        <section
          className="pointer-events-auto mb-3 w-[calc(100vw-24px)] sm:w-[400px] h-[min(620px,calc(100dvh-92px))] bg-card border border-border shadow-2xl rounded-lg overflow-hidden flex flex-col"
          aria-label="Assistente Leo"
        >
          <header className="h-16 px-3.5 flex items-center gap-3 border-b border-border bg-card shrink-0">
            <LeoLogo size="sm" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-foreground">Copilot Industrial</h2>
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Online
              </p>
            </div>
            <button
              type="button"
              onClick={clearConversation}
              className="w-9 h-9 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors"
              title="Limpar conversa"
              aria-label="Limpar conversa"
            >
              <Eraser className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-9 h-9 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors"
              title="Fechar assistente"
              aria-label="Fechar assistente"
            >
              <X className="w-4 h-4" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-3.5 py-4 space-y-4 bg-background/45">
            {messages.map((message) => (
              <div key={message.id} className={cn('flex gap-2.5', message.role === 'user' && 'justify-end')}>
                {message.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-md bg-[#76FB91] text-black flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                )}
                <div className={cn('max-w-[84%] space-y-2', message.role === 'user' && 'items-end')}>
                  <div className={cn(
                    'px-3.5 py-2.5 rounded-lg text-sm leading-relaxed whitespace-pre-line border',
                    message.role === 'user'
                      ? 'bg-foreground text-background border-foreground'
                      : 'bg-card text-foreground border-border/80',
                  )}>
                    {message.content}
                  </div>
                  {!!message.actions?.length && (
                    <div className="flex flex-wrap gap-1.5">
                      {message.actions.map((action) => (
                        <button
                          key={`${message.id}-${action.path}`}
                          type="button"
                          onClick={() => goTo(action.path)}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-100 dark:hover:bg-emerald-950/40 transition-colors"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {!!message.suggestions?.length && (
                    <div className="flex flex-wrap gap-1.5">
                      {message.suggestions.map((suggestion) => (
                        <button
                          key={`${message.id}-${suggestion}`}
                          type="button"
                          onClick={() => sendQuestion(suggestion)}
                          className="text-xs px-2.5 py-1.5 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex gap-2.5 items-center">
                <div className="w-7 h-7 rounded-md bg-[#76FB91] text-black flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="h-9 px-3 rounded-lg border border-border bg-card flex items-center gap-1" aria-label="Consultando dados">
                  <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-pulse" />
                  <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-pulse [animation-delay:120ms]" />
                  <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-pulse [animation-delay:240ms]" />
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <footer className="border-t border-border bg-card p-3 shrink-0">
            <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-none">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => sendQuestion(prompt)}
                  disabled={loading}
                  className="shrink-0 text-[11px] px-2.5 py-1 rounded-md bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    sendQuestion();
                  }
                }}
                rows={1}
                placeholder="Pergunte sobre um lote ou indicador..."
                className="min-h-10 max-h-24 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label="Mensagem para o Assistente Leo"
              />
              <button
                type="button"
                onClick={() => sendQuestion()}
                disabled={!input.trim() || loading}
                className="w-10 h-10 inline-flex items-center justify-center rounded-md bg-foreground text-background hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                title="Enviar mensagem"
                aria-label="Enviar mensagem"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </footer>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="pointer-events-auto ml-auto w-14 h-14 rounded-full bg-[#00522d] text-[#fff200] border-2 border-white shadow-xl inline-flex items-center justify-center hover:scale-105 active:scale-95 transition-transform relative"
        aria-label={open ? 'Fechar Copilot Industrial' : 'Abrir Copilot Industrial'}
        title={open ? 'Fechar Copilot Industrial' : 'Abrir Copilot Industrial'}
      >
        {open ? <MessageCircle className="w-6 h-6" /> : <Sparkles className="w-6 h-6" />}
        {!open && <span className="absolute top-0.5 right-0.5 w-3 h-3 rounded-full bg-[#76FB91] border-2 border-[#00522d]" />}
      </button>
    </div>
  );
}
