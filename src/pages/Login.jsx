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
import { base44 } from '@/lib/localDb';
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

function MicrosoftIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#f35325" d="M1 1h10v10H1z" />
      <path fill="#81bc06" d="M13 1h10v10H13z" />
      <path fill="#05a6f0" d="M1 13h10v10H1z" />
      <path fill="#ffba08" d="M13 13h10v10H13z" />
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
  const [microsoftAuthError, setMicrosoftAuthError] = useState(false);
  const [microsoftLoading, setMicrosoftLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMicrosoftAuthError(false);
    setLoading(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err?.message || 'Falha ao entrar. Verifique suas credenciais.');
      setLoading(false);
    }
  };

  const handleMicrosoftLogin = async () => {
    setError('');
    setMicrosoftAuthError(false);
    setMicrosoftLoading(true);
    try {
      await base44.auth.loginWithProvider('azure', '/');
    } catch (err) {
      setMicrosoftAuthError(true);
      setError(err?.message || 'O acesso Microsoft não pôde ser iniciado.');
      setMicrosoftLoading(false);
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
                <p className="text-sm xl:text-base text-slate-600 mt-2">Sistema Leo Flow</p>
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

            {(error || microsoftAuthError) && (
              <div className="flex items-start gap-2.5 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-3" role="alert">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error || 'O login Microsoft não está habilitado. Use suas credenciais cadastradas.'}</span>
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
            id="login-microsoft-btn"
            type="button"
            onClick={handleMicrosoftLogin}
            disabled={microsoftLoading}
            className="w-full h-12 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-black flex items-center justify-center gap-3 hover:bg-slate-50 active:scale-[0.99] transition-all"
          >
            {microsoftLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MicrosoftIcon />}
            {microsoftLoading ? 'Abrindo Microsoft...' : 'Continuar com Microsoft'}
          </button>

          <div className="flex items-center justify-center gap-4 text-sm mt-6">
            <Link to="/forgot-password" className="text-slate-500 hover:text-black transition-colors">
              Esqueceu a senha?
            </Link>
          </div>

          <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
            O acesso Microsoft é liberado somente para e-mails previamente cadastrados por um administrador.
          </p>

          <div className="lg:hidden mt-8 pt-6 border-t border-slate-200 flex items-center justify-center gap-3 text-slate-600">
            <PackageCheck className="w-5 h-5 text-[#00552f]" />
            <span className="text-xs">Leo Sob Medidas · Sistema Leo Flow</span>
            <ScanLine className="w-5 h-5 text-[#00552f]" />
          </div>
        </div>
      </main>
    </div>
  );
}
