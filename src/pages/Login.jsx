import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  BarChart3,
  CircleAlert,
  FileText,
  LogIn,
  Mail,
  MonitorUp,
  PackageCheck,
  ScanLine,
  ShieldAlert,
  Target,
  UserRound,
  Loader2,
  Lock,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LeoLogo from '@/components/ui/LeoLogo';

const FACTORY_BACKGROUND = 'https://images.unsplash.com/photo-1639038312723-75ba817ef552?auto=format&fit=crop&fm=jpg&q=82&w=1800';

const FEATURES = [
  { icon: BarChart3, label: 'Painéis de Produtividade' },
  { icon: LogIn, label: 'Entrada de Produção' },
  { icon: Target, label: 'OEE e Metas' },
  { icon: UserRound, label: 'Operadores' },
  { icon: CircleAlert, label: 'Ocorrências e Paradas' },
  { icon: FileText, label: 'Relatórios e Automações' },
];

const FLOW = [
  { icon: LogIn, label: 'Entrada' },
  { icon: MonitorUp, label: 'Monitoramento' },
  { icon: CircleAlert, label: 'Ocorrências' },
  { icon: FileText, label: 'Relatórios' },
];

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleAuthError, setGoogleAuthError] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setGoogleAuthError(false);
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
    <div className="login-access-shell min-h-[100dvh] bg-[#f3f4f4]">
      <section
        className="login-access-visual relative min-h-[100dvh] overflow-hidden bg-cover bg-center"
        style={{ backgroundImage: `url(${FACTORY_BACKGROUND})` }}
        aria-label="Visão geral do sistema de produção"
      >
        <div className="absolute inset-0 bg-white/[0.82]" aria-hidden="true" />
        <div className="relative z-10 w-full max-w-[820px] mx-auto px-10 xl:px-14 2xl:px-16 py-8 flex flex-col justify-between gap-6">
          <div className="space-y-7">
            <div className="flex items-center gap-4">
              <LeoLogo size="lg" className="border-0 shadow-lg" />
              <div>
                <p className="text-xl xl:text-2xl font-extrabold text-black leading-none">Leo Sob Medidas</p>
                <p className="text-sm xl:text-base text-slate-600 mt-2">Sistema AC.Prod</p>
              </div>
            </div>

            <div className="max-w-[650px]">
              <h1 className="text-[40px] xl:text-[46px] 2xl:text-[52px] leading-[1.06] font-extrabold text-black [letter-spacing:0]">
                Controle inteligente<br />da <span className="text-[#00552f]">produção.</span>
              </h1>
              <div className="w-12 h-1 bg-[#ffd900] rounded-full mt-5 mb-4" aria-hidden="true" />
              <p className="text-base xl:text-lg text-slate-700 leading-relaxed max-w-[610px]">
                Rastreabilidade completa, mais produtividade<br className="hidden xl:block" /> e decisões precisas para a sua operação sob medida.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 xl:gap-4 max-w-[720px]">
              {FEATURES.map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="min-h-[68px] xl:min-h-[72px] bg-white/[0.88] border border-white shadow-sm rounded-lg px-4 flex items-center gap-3 backdrop-blur-sm"
                >
                  <Icon className="w-7 h-7 text-[#00552f] shrink-0" strokeWidth={1.8} />
                  <span className="text-sm xl:text-[15px] leading-snug font-medium text-slate-950">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="relative max-w-[700px] pt-2">
            <div className="absolute top-[25px] left-[8%] right-[8%] h-px bg-slate-300" aria-hidden="true" />
            <div className="grid grid-cols-4 relative">
              {FLOW.map(({ icon: Icon, label }, index) => (
                <div key={label} className="flex flex-col items-center text-center gap-2">
                  <div className="w-12 h-12 rounded-full bg-white/90 border border-white shadow-sm flex items-center justify-center text-[#00552f] relative">
                    <Icon className="w-6 h-6" strokeWidth={1.8} />
                    {index < FLOW.length - 1 && (
                      <span className="absolute left-[calc(100%+28px)] w-2 h-2 rounded-full bg-[#00552f]" aria-hidden="true" />
                    )}
                  </div>
                  <span className="text-xs xl:text-sm font-medium text-slate-900">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <main className="min-h-[100dvh] flex items-center justify-center px-4 py-6 sm:px-8 lg:px-10 xl:px-14 bg-[#f3f4f4]">
        <div className="w-full max-w-[470px] bg-white border border-white rounded-lg shadow-[0_20px_60px_rgba(15,23,42,0.10)] px-6 py-7 sm:px-9 sm:py-8 xl:px-10">
          <div className="flex flex-col items-center text-center">
            <LeoLogo size="lg" className="border-0 shadow-md" />
            <h2 className="font-leo-title text-[28px] sm:text-[30px] leading-[1.12] text-black mt-4 max-w-[360px]">
              Controle e<br />Rastreabilidade
            </h2>
            <p className="text-sm text-slate-500 mt-2">Painel de Produção Industrial</p>
          </div>

          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-bold uppercase text-slate-600 [letter-spacing:0]">
                E-mail
              </Label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  placeholder="voce@empresa.com"
                  autoComplete="email"
                  className="pl-11 h-12 rounded-lg border-slate-200 bg-white text-slate-950 placeholder:text-slate-500 focus:border-[#00552f] focus:ring-[#00552f]/15"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-bold uppercase text-slate-600 [letter-spacing:0]">
                Senha
              </Label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="pl-11 h-12 rounded-lg border-slate-200 bg-white text-slate-950 placeholder:text-slate-500 focus:border-[#00552f] focus:ring-[#00552f]/15"
                />
              </div>
            </div>

            {(error || googleAuthError) && (
              <div className="flex items-start gap-2.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-3" role="alert">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error || 'O login com Google não está habilitado. Use suas credenciais cadastradas.'}</span>
              </div>
            )}

            <button
              id="login-submit-btn"
              type="submit"
              disabled={loading}
              className="w-full h-12 rounded-lg bg-black text-white flex items-center justify-center gap-3 font-semibold text-sm shadow-lg shadow-black/15 hover:bg-[#00552f] active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <div className="flex items-center gap-4 my-5" aria-hidden="true">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-[11px] uppercase font-semibold text-slate-500">ou</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          <button
            id="login-google-btn"
            type="button"
            onClick={() => {
              setGoogleAuthError(true);
              setError('');
            }}
            className="w-full h-12 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-black flex items-center justify-center gap-3 hover:bg-slate-50 active:scale-[0.99] transition-all"
          >
            <GoogleIcon />
            Continuar com Google
          </button>

          <div className="flex items-center justify-between gap-4 text-sm mt-6">
            <Link to="/forgot-password" className="text-slate-500 hover:text-black transition-colors">
              Esqueceu a senha?
            </Link>
            <Link to="/register" className="text-black font-semibold hover:text-[#00552f] transition-colors">
              Criar conta
            </Link>
          </div>

          <div className="lg:hidden mt-8 pt-6 border-t border-slate-200 flex items-center justify-center gap-3 text-slate-600">
            <PackageCheck className="w-5 h-5 text-[#00552f]" />
            <span className="text-xs">Leo Sob Medidas · Sistema AC.Prod</span>
            <ScanLine className="w-5 h-5 text-[#00552f]" />
          </div>
        </div>
      </main>
    </div>
  );
}
