import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Mail, CheckCircle2, ShieldAlert, ArrowLeft } from 'lucide-react';
import LeoLogo from '@/components/ui/LeoLogo';
import { base44 } from '@/lib/localDb';

export default function ForgotPasswordModal({ open, onOpenChange }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await base44.auth.resetPasswordRequest(email);
      setSent(true);
    } catch (err) {
      const rawMsg = (err?.message || '').toLowerCase();

      if (rawMsg.includes('rate limit') || rawMsg.includes('too many requests') || rawMsg.includes('429')) {
        setError('Muitas solicitações para este e-mail. Aguarde alguns minutos antes de pedir um novo link.');
      } else if (rawMsg.includes('user not found') || rawMsg.includes('invalid email')) {
        setError('E-mail não encontrado no cadastro do sistema. Verifique o endereço digitado.');
      } else {
        setError(err?.message || 'Não foi possível solicitar a recuperação. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setEmail('');
    setSent(false);
    setError('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-[420px] bg-slate-900 border-slate-800 text-slate-100 p-6 sm:p-8 rounded-3xl shadow-2xl backdrop-blur-xl">
        <DialogHeader className="flex flex-col items-center text-center space-y-3">
          <LeoLogo size="lg" className="border-0 shadow-lg mb-1" />
          <DialogTitle className="text-2xl font-bold text-white tracking-tight font-display">
            Recuperar Senha
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-400 max-w-[320px]">
            {sent
              ? 'As instruções de acesso foram enviadas com sucesso.'
              : 'Informe seu e-mail cadastrado no Leo Flow para receber a mensagem de recuperação.'}
          </DialogDescription>
        </DialogHeader>

        {sent ? (
          <div className="space-y-5 my-2">
            <div className="flex flex-col items-center text-center p-4 bg-emerald-950/40 border border-emerald-800/50 rounded-2xl space-y-2">
              <CheckCircle2 className="w-10 h-10 text-[#76FB91] animate-in zoom-in-50 duration-300" />
              <p className="text-sm font-semibold text-emerald-200">
                E-mail enviado!
              </p>
              <p className="text-xs text-slate-300 leading-relaxed">
                Enviamos a instrução para <strong className="text-white">{email}</strong>. Verifique sua caixa de entrada para definir sua nova senha.
              </p>
            </div>

            <button
              type="button"
              onClick={handleClose}
              className="w-full h-11 rounded-xl bg-[#005f2f] hover:bg-[#004a24] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#005f2f]/30 active:scale-[0.98] transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
              Voltar ao Login
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 my-2" autoComplete="off">
            <div className="space-y-1.5">
              <Label htmlFor="forgot-email" className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                E-mail Cadastrado
              </Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                <Input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="voce@empresa.com"
                  autoComplete="off"
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
              className="w-full h-11 rounded-xl bg-[#005f2f] hover:bg-[#004a24] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-[#005f2f]/30 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Enviar Link de Recuperação'
              )}
            </button>

            <button
              type="button"
              onClick={handleClose}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-200 transition-colors pt-1 block"
            >
              Cancelar e voltar ao login
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
