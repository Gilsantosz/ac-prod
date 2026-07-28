import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LogIn,
  Mail,
  Lock,
  ShieldAlert,
  Loader2,
  Activity,
  Layers,
  Gauge,
  ShieldCheck,
  CheckCircle2,
  Cpu,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import LeoLogo from '@/components/ui/LeoLogo';
import ForgotPasswordModal from '@/components/auth/ForgotPasswordModal';

const SYSTEM_HIGHLIGHTS = [
  {
    icon: Layers,
    title: 'Rastreabilidade MES',
    desc: 'Acompanhamento por lote, ordem de produção e código de barras.',
    tag: 'Tempo Real',
  },
  {
    icon: Gauge,
    title: 'OEE & Produtividade',
    desc: 'Cálculo automatizado de disponibilidade, desempenho e qualidade.',
    tag: 'Métricas MES',
  },
  {
    icon: ShieldCheck,
    title: 'Qualidade & Reposições',
    desc: 'Fluxo integrado de não conformidades e aprovações.',
    tag: 'Auditoria',
  },
];

export default function Login() {
  const { login, authError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);

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
    <div className="min-h-[100dvh] w-full bg-slate-950 text-slate-100 flex flex-col justify-between relative overflow-hidden font-sans">

      {/* ── Background Gradients & Glows ───────────────────────────────────── */}
      <div
        className="absolute -top-40 -left-40 w-[650px] h-[650px] bg-[#005f2f]/25 rounded-full blur-[140px] pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute -bottom-40 -right-40 w-[650px] h-[650px] bg-[#76FB91]/10 rounded-full blur-[140px] pointer-events-none"
        aria-hidden="true"
      />

      {/* Grid Pattern overlay */}
      <div
        className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b15_1px,transparent_1px),linear-gradient(to_bottom,#1e293b15_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none"
        aria-hidden="true"
      />

      {/* ── Header Superior de Status ──────────────────────────────────────── */}
      <header className="relative z-10 w-full max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LeoLogo size="md" className="border-border/40 shadow-xl" />
          <div>
            <span className="font-extrabold text-lg text-white tracking-tight leading-none block font-display">
              Leo Sob Medidas
            </span>
            <span className="text-xs text-emerald-400/90 font-semibold tracking-wide mt-0.5 block">
              Sistema MES Leo Flow
            </span>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-3">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-950/60 border border-emerald-800/50 text-xs font-semibold text-emerald-300 backdrop-blur-md">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Sistema Operacional
          </div>
        </div>
      </header>

      {/* ── Main Content: Grid 2 Colunas ───────────────────────────────────── */}
      <main className="relative z-10 w-full max-w-7xl mx-auto px-6 py-4 my-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">

          {/* ── Coluna Esquerda: Visão Geral do Sistema ───────────────────── */}
          <div className="lg:col-span-7 space-y-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-300">
                <Cpu className="w-3.5 h-3.5 text-[#76FB91]" />
                <span>Controle & Rastreabilidade Industrial</span>
              </div>
              <h1 className="text-3xl sm:text-4xl xl:text-5xl font-black text-white leading-[1.12] tracking-tight font-display">
                Plataforma MES para Gestão de <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#76FB91] via-emerald-400 to-[#005f2f]">Produção Sob Medida</span>
              </h1>
              <p className="text-sm sm:text-base text-slate-400 max-w-2xl leading-relaxed">
                Acompanhamento em tempo real por célula, turno e ordem de produção. Controle total de disponibilidade, ritmo, qualidade e reprovações.
              </p>
            </div>

            {/* Cards de Módulos */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {SYSTEM_HIGHLIGHTS.map(({ icon: Icon, title, desc, tag }) => (
                <div
                  key={title}
                  className="bg-slate-900/70 border border-slate-800/80 hover:border-emerald-500/30 rounded-2xl p-4 transition-all duration-300 backdrop-blur-md group"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-9 h-9 rounded-xl bg-[#005f2f]/30 border border-[#005f2f]/50 flex items-center justify-center text-[#76FB91] group-hover:scale-105 transition-transform">
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-800/40">
                      {tag}
                    </span>
                  </div>
                  <h3 className="font-bold text-sm text-white mb-1 leading-snug">{title}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>

            {/* Badges de Status Técnico */}
            <div className="pt-2 flex flex-wrap items-center gap-4 text-xs text-slate-400 font-medium border-t border-slate-900">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Supabase Cloud Sync</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                <span>Monitoramento OEE Nível MES</span>
              </div>
              <div className="flex items-center gap-1.5">
                <LogIn className="w-3.5 h-3.5 text-emerald-400" />
                <span>Pronto para PWA & Coletor</span>
              </div>
            </div>
          </div>

          {/* ── Coluna Direita: Formulário de Acesso ─────────────────────── */}
          <div className="lg:col-span-5 flex justify-center lg:justify-end">
            <div className="w-full max-w-[430px] relative">
              {/* Moldura / Glow no topo do card */}
              <div className="absolute -top-[1px] inset-x-8 h-[2px] bg-gradient-to-r from-transparent via-[#76FB91] to-transparent z-20" />

              <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-7 sm:p-9 shadow-2xl shadow-black/80 backdrop-blur-xl relative z-10 space-y-6">

                {/* Cabeçalho do Card */}
                <div className="text-center space-y-1.5">
                  <h2 className="text-2xl font-bold text-white tracking-tight font-display">
                    Acesso ao Sistema
                  </h2>
                  <p className="text-xs text-slate-400">
                    Digite suas credenciais de operador ou gestor
                  </p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                      E-mail Corporativo
                    </Label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                      <Input
                        id="user-email-input"
                        name="user_email_identity"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        placeholder="voce@empresa.com"
                        autoComplete="off"
                        aria-autocomplete="none"
                        data-lpignore="true"
                        data-1password-ignore="true"
                        className="pl-10 h-11 bg-slate-950/90 border-slate-800 text-slate-100 placeholder:text-slate-600 rounded-xl focus:border-[#76FB91] focus:ring-[#76FB91]/20 text-sm transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="password" className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                        Senha
                      </Label>
                      <button
                        type="button"
                        onClick={() => setShowForgotModal(true)}
                        className="text-xs text-slate-400 hover:text-[#76FB91] transition-colors font-medium cursor-pointer"
                      >
                        Esqueceu a senha?
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                      <Input
                        id="user-password-input"
                        name="user_login_secret"
                        type="text"
                        style={{ WebkitTextSecurity: 'disc' }}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        placeholder="••••••••"
                        autoComplete="off"
                        aria-autocomplete="none"
                        data-lpignore="true"
                        data-1password-ignore="true"
                        className="pl-10 h-11 bg-slate-950/90 border-slate-800 text-slate-100 placeholder:text-slate-600 rounded-xl focus:border-[#76FB91] focus:ring-[#76FB91]/20 text-sm transition-all"
                      />
                    </div>
                  </div>

                  {(error || authError?.message) && (
                    <div
                      className="flex items-start gap-2.5 text-xs text-rose-300 bg-rose-950/60 border border-rose-800/60 rounded-xl p-3 shadow-sm"
                      role="alert"
                      aria-live="assertive"
                    >
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                      <span className="leading-relaxed">{error || authError?.message}</span>
                    </div>
                  )}

                  <button
                    id="login-submit-btn"
                    type="submit"
                    disabled={loading}
                    className="w-full h-11 rounded-xl bg-[#005f2f] hover:bg-[#004a24] active:scale-[0.98] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#005f2f]/30 transition-all disabled:opacity-60 disabled:cursor-not-allowed group mt-2"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <span>Entrar no Leo Flow</span>
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                      </>
                    )}
                  </button>
                </form>

                <div className="pt-2 border-t border-slate-800/60 text-center">
                  <p className="text-[11px] text-slate-500 font-medium">
                    Acesso restrito a usuários cadastrados no sistema
                  </p>
                </div>

              </div>
            </div>
          </div>

        </div>
      </main>

      {/* ── Modal de Esqueci a Senha ───────────────────────────────────────── */}
      <ForgotPasswordModal
        open={showForgotModal}
        onOpenChange={setShowForgotModal}
      />

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="relative z-10 w-full max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-slate-500 border-t border-slate-900">
        <div>
          <strong className="text-slate-400">Leo Sob Medidas</strong> · Sistema MES de Controle de Produção
        </div>
        <div className="flex items-center gap-3">
          <span>Versão 1.4</span>
          <span>•</span>
          <span>PWA / Standalone Ready</span>
        </div>
      </footer>

    </div>
  );
}
