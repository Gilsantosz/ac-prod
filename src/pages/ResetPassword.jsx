import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/lib/localDb';
import { supabase } from '@/lib/supabaseClient';
import {
  clearRecoveryCredentialsFromUrl,
  resolvePasswordRecoverySession,
} from '@/lib/passwordRecovery';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Lock, ShieldAlert, CheckCircle2, ArrowLeft } from 'lucide-react';
import LeoLogo from '@/components/ui/LeoLogo';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [linkStatus, setLinkStatus] = useState('validating');
  const [linkError, setLinkError] = useState('');

  useEffect(() => {
    let active = true;

    const validateRecoveryLink = async () => {
      try {
        await resolvePasswordRecoverySession(supabase.auth);
        if (!active) return;
        clearRecoveryCredentialsFromUrl();
        setLinkStatus('valid');
      } catch (err) {
        if (!active) return;
        setLinkError(
          err?.message?.toLowerCase().includes('expired')
            ? 'Este link expirou. Solicite uma nova mensagem de recuperação.'
            : 'Este link é inválido, já foi utilizado ou expirou.',
        );
        setLinkStatus('invalid');
      }
    };

    validateRecoveryLink();
    return () => { active = false; };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('A nova senha deve possuir pelo menos 6 caracteres.');
      return;
    }

    if (password !== confirm) {
      setError('As senhas não coincidem. Digite novamente.');
      return;
    }

    setLoading(true);
    try {
      await base44.auth.resetPassword({ newPassword: password });
      try {
        await base44.auth.logout();
      } catch {
        // A senha já foi salva. Uma eventual falha de logout não deve induzir
        // o usuário a repetir a alteração com o mesmo link de uso único.
      }
      setSuccess(true);
    } catch (err) {
      const rawMsg = (err?.message || '').toLowerCase();
      let userMessage = 'Falha ao redefinir a senha. O link de recuperação pode ter expirado.';
      if (rawMsg.includes('same password') || rawMsg.includes('should be different')) {
        userMessage = 'A nova senha deve ser diferente da senha anterior.';
      } else if (rawMsg.includes('rate limit') || rawMsg.includes('429')) {
        userMessage = 'Muitas tentativas em curto intervalo. Aguarde 1 a 2 minutos e tente salvar novamente.';
      } else if (err?.message) {
        userMessage = err.message;
      }
      setError(userMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center p-4 sm:p-6 md:p-8 bg-slate-950 text-slate-100 relative overflow-hidden font-sans">
      {/* Glow decorativo de fundo */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#005f2f]/20 rounded-full blur-[120px] pointer-events-none"
        aria-hidden="true"
      />

      <main className="w-full max-w-[430px] relative z-10">
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-7 sm:p-9 shadow-2xl backdrop-blur-xl space-y-6">

          {/* Cabeçalho */}
          <div className="flex flex-col items-center text-center space-y-3">
            <LeoLogo size="lg" className="border-0 shadow-lg" />
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight font-display">
                Nova Senha
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                {success
                  ? 'Sua senha foi atualizada com sucesso.'
                  : 'Crie uma nova senha de acesso para sua conta no Leo Flow.'}
              </p>
            </div>
          </div>

          <div className="h-px w-full bg-slate-800/80" />

          {linkStatus === 'validating' ? (
            <div className="flex flex-col items-center text-center py-8 space-y-3" role="status">
              <Loader2 className="w-8 h-8 animate-spin text-[#76FB91]" />
              <p className="text-sm font-semibold text-slate-200">Validando seu link...</p>
              <p className="text-xs text-slate-400">Aguarde enquanto confirmamos a solicitação com segurança.</p>
            </div>
          ) : linkStatus === 'invalid' ? (
            <div className="space-y-5">
              <div className="flex flex-col items-center text-center p-5 bg-rose-950/40 border border-rose-800/60 rounded-2xl space-y-2" role="alert">
                <ShieldAlert className="w-11 h-11 text-rose-400" />
                <h2 className="text-base font-bold text-rose-200">Link inválido ou expirado</h2>
                <p className="text-xs text-slate-300 leading-relaxed">{linkError}</p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/forgot-password', { replace: true })}
                className="w-full h-11 rounded-xl bg-[#005f2f] hover:bg-[#004a24] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#005f2f]/30 active:scale-[0.98] transition-all cursor-pointer"
              >
                Solicitar Novo Link
              </button>
              <button
                type="button"
                onClick={() => navigate('/login', { replace: true })}
                className="w-full text-center text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                Voltar ao login
              </button>
            </div>
          ) : success ? (
            <div className="space-y-6">
              <div className="flex flex-col items-center text-center p-5 bg-emerald-950/40 border border-emerald-800/50 rounded-2xl space-y-2">
                <CheckCircle2 className="w-12 h-12 text-[#76FB91] animate-in zoom-in-50 duration-300" />
                <h2 className="text-base font-bold text-emerald-200">
                  Senha Redefinida!
                </h2>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Sua nova senha foi salva no sistema. Você já pode fazer login normalmente.
                </p>
              </div>

              <button
                type="button"
                onClick={() => navigate('/login', { replace: true })}
                className="w-full h-11 rounded-xl bg-[#005f2f] hover:bg-[#004a24] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#005f2f]/30 active:scale-[0.98] transition-all cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                Ir para o Login
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Nova Senha
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="Mínimo 6 caracteres"
                    autoComplete="new-password"
                    data-lpignore="true"
                    className="pl-10 h-11 bg-slate-950/90 border-slate-800 text-slate-100 placeholder:text-slate-600 rounded-xl focus:border-[#76FB91] focus:ring-[#76FB91]/20 text-sm transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm" className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Confirmar Nova Senha
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                  <Input
                    id="confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    placeholder="Repita a nova senha"
                    autoComplete="new-password"
                    data-lpignore="true"
                    className="pl-10 h-11 bg-slate-950/90 border-slate-800 text-slate-100 placeholder:text-slate-600 rounded-xl focus:border-[#76FB91] focus:ring-[#76FB91]/20 text-sm transition-all"
                  />
                </div>
              </div>

              {error && (
                <div
                  className="flex items-start gap-2.5 text-xs text-rose-300 bg-rose-950/60 border border-rose-800/60 rounded-xl p-3"
                  role="alert"
                >
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                  <span className="leading-relaxed">{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 rounded-xl bg-[#005f2f] hover:bg-[#004a24] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#005f2f]/30 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed mt-2 cursor-pointer"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Salvar Nova Senha'
                )}
              </button>

              <button
                type="button"
                onClick={() => navigate('/login', { replace: true })}
                className="w-full text-center text-xs text-slate-400 hover:text-slate-200 transition-colors pt-2 block cursor-pointer"
              >
                Cancelar e ir ao login
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
