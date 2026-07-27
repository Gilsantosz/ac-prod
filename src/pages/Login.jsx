import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  LogIn,
  Mail,
  Lock,
  ShieldAlert,
  Loader2,
  Factory,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LeoLogo from '@/components/ui/LeoLogo';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
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

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center p-4 sm:p-6 md:p-8 bg-slate-950 text-slate-100 relative overflow-hidden">
      {/* Glow decorativo de fundo */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#005f2f]/15 rounded-full blur-[120px] pointer-events-none"
        aria-hidden="true"
      />

      <main className="w-full max-w-[420px] relative z-10">
        <div className="bg-slate-900/90 border border-slate-800/90 rounded-3xl p-7 sm:p-9 shadow-2xl backdrop-blur-xl space-y-6">

          {/* Cabeçalho da Marca */}
          <div className="flex flex-col items-center text-center space-y-3">
            <LeoLogo size="lg" className="border-0 shadow-lg" />
            <div>
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight font-display">
                Leo Sob Medidas
              </h1>
              <p className="text-xs text-slate-400 font-medium mt-0.5">
                Sistema Leo Flow MES
              </p>
            </div>
          </div>

          {/* Divisor Discreto */}
          <div className="h-px w-full bg-slate-800/80" />

          {/* Formulário de Acesso */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                E-mail
              </Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="voce@empresa.com"
                  autoComplete="email"
                  className="pl-10 h-11 bg-slate-950/80 border-slate-800 text-slate-100 placeholder:text-slate-600 rounded-xl focus:border-[#76FB91] focus:ring-[#76FB91]/20 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Senha
                </Label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-slate-400 hover:text-[#76FB91] transition-colors"
                >
                  Esqueceu a senha?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="pl-10 h-11 bg-slate-950/80 border-slate-800 text-slate-100 placeholder:text-slate-600 rounded-xl focus:border-[#76FB91] focus:ring-[#76FB91]/20 text-sm"
                />
              </div>
            </div>

            {error && (
              <div
                className="flex items-start gap-2.5 text-xs text-rose-300 bg-rose-950/50 border border-rose-800/60 rounded-xl p-3"
                role="alert"
              >
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            <button
              id="login-submit-btn"
              type="submit"
              disabled={loading}
              className="w-full h-11 rounded-xl bg-[#005f2f] hover:bg-[#004a24] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#005f2f]/30 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              {loading ? 'Acessando...' : 'Entrar no Sistema'}
            </button>
          </form>

          {/* Rodapé Industrial */}
          <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500 font-medium">
            <div className="flex items-center gap-1.5">
              <Factory className="w-3.5 h-3.5 text-[#76FB91]" />
              <span>Ambiente Industrial</span>
            </div>
            <span>v1.4</span>
          </div>

        </div>
      </main>
    </div>
  );
}
