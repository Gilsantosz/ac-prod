import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ShieldAlert, ArrowLeft, Mail, Lock, LogIn } from 'lucide-react';
import LeoLogo from '@/components/ui/LeoLogo';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleAuthError, setGoogleAuthError] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err?.message || 'Falha ao entrar. Verifique suas credenciais.');
      setLoading(false);
    }
  };

  const handleGoogle = () => {
    setGoogleAuthError(true);
  };

  /* ── Tela de Acesso Negado (Google) ─────────────────────────── */
  if (googleAuthError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        {/* Decoração de fundo */}
        <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -left-40 w-80 h-80 rounded-full bg-primary/8 blur-3xl" />
          <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-primary/6 blur-3xl" />
        </div>

        <div className="login-card w-full max-w-md p-8 sm:p-10 space-y-6 text-center relative z-10 animate-fade-up">
          <div className="flex flex-col items-center gap-4">
            <div className="w-20 h-20 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center text-destructive animate-glow-pulse">
              <ShieldAlert className="w-10 h-10" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold text-foreground">Sem Autorização</h1>
              <p className="text-muted-foreground text-sm mt-2 max-w-xs mx-auto leading-relaxed">
                O login com Google não está habilitado neste sistema. Use suas credenciais cadastradas.
              </p>
            </div>
          </div>

          <button
            className="w-full flex items-center justify-center gap-2.5 h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-95 transition-all duration-200 shadow-md shadow-primary/25"
            onClick={() => setGoogleAuthError(false)}
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar para o login convencional
          </button>
        </div>
      </div>
    );
  }

  /* ── Tela de Login Principal ─────────────────────────────────── */
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">

      {/* Orbs decorativos de fundo */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="absolute -top-60 -left-60 w-[600px] h-[600px] rounded-full bg-primary/6 blur-3xl" />
        <div className="absolute -bottom-60 -right-60 w-[600px] h-[600px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full bg-primary/3 blur-3xl" />
      </div>

      <div className="login-card w-full max-w-md relative z-10 animate-fade-up">

        {/* Linha superior gradiente decorativa */}
        <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent rounded-full" />

        <div className="p-8 sm:p-10 space-y-7">

          {/* ── Cabeçalho ─────────────────────────────────────────── */}
          <div className="flex flex-col items-center text-center gap-4">
            <div className="relative">
              <div className="absolute inset-0 rounded-2xl bg-primary/15 blur-xl scale-150" />
              <LeoLogo size="lg" className="relative" />
            </div>
            <div>
              <h1 className="font-display text-3xl font-extrabold text-foreground tracking-tight">
                AC. Produção
              </h1>
              <p className="text-muted-foreground text-sm mt-1.5">
                Painel de Produção Industrial
              </p>
            </div>
          </div>

          {/* ── Formulário ────────────────────────────────────────── */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                E-mail
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="voce@empresa.com"
                  autoComplete="off"
                  className="pl-10 h-12 rounded-xl border-border/70 bg-secondary/40 focus:border-primary/60 focus:ring-primary/20 transition-all"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Senha
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  autoComplete="one-time-code"
                  className="pl-10 h-12 rounded-xl border-border/70 bg-secondary/40 focus:border-primary/60 focus:ring-primary/20 transition-all"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/8 border border-destructive/20 rounded-xl px-4 py-3 animate-fade-up">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              id="login-submit-btn"
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2.5 h-12 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all duration-200 shadow-lg shadow-primary/30 disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Entrar
                </>
              )}
            </button>
          </form>

          {/* ── Separador ─────────────────────────────────────────── */}
          <div className="relative flex items-center gap-4">
            <div className="flex-1 h-px bg-border/60" />
            <span className="text-xs text-muted-foreground font-medium">ou</span>
            <div className="flex-1 h-px bg-border/60" />
          </div>

          {/* ── Botão Google (bloqueado) ──────────────────────────── */}
          <button
            id="login-google-btn"
            type="button"
            onClick={handleGoogle}
            className="w-full flex items-center justify-center gap-3 h-12 rounded-xl border border-border/70 bg-secondary/30 text-sm font-medium text-foreground hover:bg-secondary/50 active:scale-[0.98] transition-all duration-200"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continuar com Google
          </button>

          {/* ── Links auxiliares ──────────────────────────────────── */}
          <div className="flex items-center justify-between text-sm pt-1">
            <Link
              to="/forgot-password"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Esqueceu a senha?
            </Link>
            <Link
              to="/register"
              className="text-primary font-semibold hover:opacity-80 transition-opacity"
            >
              Criar conta
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}