import { useState } from 'react';
import { LogIn, User, Lock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOperatorSession } from '@/hooks/useOperatorSession';

/**
 * OperationalLoginGate
 *
 * Bloqueia acesso à Entrada de Produção até que o operador realize
 * login operacional (nome + matrícula). Ao autenticar, renderiza os filhos.
 */
export default function OperationalLoginGate({ children }) {
  const { isLoggedIn, loading, error, login } = useOperatorSession();
  const [name, setName] = useState('');
  const [registration, setRegistration] = useState('');

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
    <div className="flex items-center justify-center min-h-[60vh] p-4">
      <div className="w-full max-w-sm space-y-6">

        {/* Cabeçalho */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#2d9c4a]/10 mb-2">
            <LogIn className="w-7 h-7 text-[#2d9c4a]" />
          </div>
          <h2 className="text-xl font-bold text-foreground">Acesso à Produção</h2>
          <p className="text-sm text-muted-foreground">
            Informe seu nome e matrícula para iniciar o turno.
          </p>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="space-y-4 bg-card border border-border rounded-2xl p-6 shadow-sm">

          {/* Nome */}
          <div className="space-y-1.5">
            <Label htmlFor="op-name" className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" /> Nome do operador
            </Label>
            <Input
              id="op-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Carlos Silva"
              required
              autoComplete="off"
              autoFocus
              className="h-11 rounded-xl"
            />
          </div>

          {/* Matrícula */}
          <div className="space-y-1.5">
            <Label htmlFor="op-reg" className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" /> Matrícula
            </Label>
            <Input
              id="op-reg"
              type="password"
              value={registration}
              onChange={(e) => setRegistration(e.target.value)}
              placeholder="Ex: 00123"
              required
              autoComplete="one-time-code"
              className="h-11 rounded-xl"
            />
          </div>

          {/* Erro */}
          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-destructive/10 border border-destructive/20 px-3.5 py-3 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            disabled={loading || !name.trim() || !registration.trim()}
            className="w-full h-11 rounded-xl font-semibold bg-[#2d9c4a] hover:bg-[#237d3a] text-white"
          >
            {loading ? 'Verificando...' : 'Entrar na Produção'}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Operador não cadastrado? Solicite ao supervisor.
        </p>
      </div>
    </div>
  );
}
