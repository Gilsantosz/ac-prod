import { useState } from 'react';
import { LogIn, User, Lock, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOperatorSession } from '@/hooks/useOperatorSession';

/**
 * OperationalLoginGate
 *
 * Bloqueia acesso à Entrada de Produção até que o operador realize
 * login operacional (nome + matrícula). Ao autenticar, renderiza os filhos.
 * Redesenhado com estética premium, efeitos visuais modernos e micro-interações.
 */
export default function OperationalLoginGate({ children }) {
  const { isLoggedIn, loading, error, login } = useOperatorSession();
  const [name, setName] = useState('');
  const [registration, setRegistration] = useState('');
  const [isFocused, setIsFocused] = useState(null);

  if (isLoggedIn) return children;

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await login(name, registration);
    } catch (_) {
      // erro já tratado pelo hook
    }
  };

  return (
    <div className="relative min-h-[75vh] flex items-center justify-center p-4 overflow-hidden bg-gradient-to-tr from-background via-secondary/10 to-background">
      
      {/* Efeito de Brilho de Fundo (Ambient Glow) */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-emerald-500/10 blur-[100px] pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-72 h-72 rounded-full bg-teal-500/5 blur-[80px] pointer-events-none" />

      <div className="relative w-full max-w-md space-y-6 z-10">
        
        {/* Cabeçalho com Animação sutil */}
        <div className="text-center space-y-3">
          <div className="relative inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 mb-1 group transition-all duration-300 hover:border-emerald-500/40">
            <LogIn className="w-8 h-8 text-emerald-600 dark:text-emerald-400 group-hover:scale-110 transition-transform duration-300" />
            <div className="absolute inset-0 rounded-2xl bg-emerald-500/5 animate-ping opacity-75 pointer-events-none" style={{ animationDuration: '3s' }} />
          </div>
          
          <h2 className="text-2xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/80">
            Acesso à Produção
          </h2>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            Informe seu nome e matrícula de operador para iniciar o turno de trabalho.
          </p>
        </div>

        {/* Card Principal - Glassmorphism */}
        <form 
          onSubmit={handleSubmit} 
          className="bg-card/70 backdrop-blur-xl border border-border/80 rounded-2xl p-6 sm:p-8 shadow-xl shadow-foreground/5 space-y-5 transition-all duration-300"
        >
          {/* Input: Nome do Operador */}
          <div className="space-y-2">
            <Label 
              htmlFor="op-name" 
              className={`text-xs font-bold uppercase tracking-wider transition-colors duration-200 flex items-center gap-2 ${
                isFocused === 'name' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
              }`}
            >
              <User className="w-3.5 h-3.5" /> Nome do operador
            </Label>
            <div className="relative">
              <Input
                id="op-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onFocus={() => setIsFocused('name')}
                onBlur={() => setIsFocused(null)}
                placeholder="Ex: Carlos Silva"
                required
                autoComplete="off"
                autoFocus
                className="h-12 pl-4 rounded-xl border-border/80 bg-background/50 focus:bg-background focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all duration-200 text-sm font-medium"
              />
            </div>
          </div>

          {/* Input: Matrícula */}
          <div className="space-y-2">
            <Label 
              htmlFor="op-reg" 
              className={`text-xs font-bold uppercase tracking-wider transition-colors duration-200 flex items-center gap-2 ${
                isFocused === 'reg' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
              }`}
            >
              <Lock className="w-3.5 h-3.5" /> Matrícula
            </Label>
            <div className="relative">
              <Input
                id="op-reg"
                type="password"
                value={registration}
                onChange={(e) => setRegistration(e.target.value)}
                onFocus={() => setIsFocused('reg')}
                onBlur={() => setIsFocused(null)}
                placeholder="Ex: 00123"
                required
                autoComplete="one-time-code"
                className="h-12 pl-4 rounded-xl border-border/80 bg-background/50 focus:bg-background focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all duration-200 text-sm font-medium"
              />
            </div>
          </div>

          {/* Banner de Erro com Transição Suave */}
          {error && (
            <div className="flex items-start gap-2.5 rounded-xl bg-destructive/10 border border-destructive/20 p-3.5 text-xs font-medium text-destructive animate-headShake">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span className="leading-normal">{error}</span>
            </div>
          )}

          {/* Botão de Entrar */}
          <Button
            type="submit"
            disabled={loading || !name.trim() || !registration.trim()}
            className="w-full h-12 rounded-xl font-bold bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white shadow-md shadow-emerald-500/10 hover:shadow-lg hover:shadow-emerald-500/20 transition-all duration-300 transform hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none disabled:transform-none"
          >
            {loading ? (
              <span className="flex items-center gap-2 justify-center">
                <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Verificando...
              </span>
            ) : (
              'Entrar na Produção'
            )}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground/80 font-medium">
          Operador não cadastrado? Solicite auxílio ao seu supervisor.
        </p>
      </div>
    </div>
  );
}
