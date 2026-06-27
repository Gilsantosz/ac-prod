import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { base44 } from '@/lib/localDb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import LeoLogo from '@/components/ui/LeoLogo';

export default function Register() {
  const navigate = useNavigate();
  const [step, setStep] = useState('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('As senhas não coincidem.'); return; }
    setLoading(true);
    try {
      await base44.auth.register({ email, password });
      setStep('otp');
    } catch (err) {
      setError(err?.message || 'Falha ao registrar.');
    }
    setLoading(false);
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await base44.auth.verifyOtp({ email, otpCode: otp });
      navigate('/painel', { replace: true });
    } catch (err) {
      setError(err?.message || 'Código inválido.');
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    try { await base44.auth.resendOtp(email); } catch (err) { setError(err?.message || 'Erro ao reenviar.'); }
  };

  const handleGoogle = () => base44.auth.loginWithProvider('google', '/painel');

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 shadow-xl border-border/60">
        <div className="flex flex-col items-center mb-8">
          <LeoLogo size="lg" className="mb-4" />
          <h1 className="text-2xl font-bold">{step === 'register' ? 'Criar conta' : 'Verifique seu e-mail'}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {step === 'register' ? 'Painel de Produção Industrial' : `Enviamos um código para ${email}`}
          </p>
        </div>

        {step === 'register' ? (
          <>
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirmar senha</Label>
                <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Criar conta'}
              </Button>
            </form>
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
              <div className="relative flex justify-center text-xs"><span className="bg-card px-2 text-muted-foreground">ou</span></div>
            </div>
            <Button variant="outline" className="w-full" onClick={handleGoogle}>Continuar com Google</Button>
            <p className="text-center text-sm mt-6 text-muted-foreground">
              Já tem conta? <Link to="/login" className="text-accent font-medium hover:underline">Entrar</Link>
            </p>
          </>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="otp">Código de verificação</Label>
              <Input id="otp" value={otp} onChange={(e) => setOtp(e.target.value)} required placeholder="000000" className="text-center text-lg font-bold tracking-widest" maxLength={6} />
            </div>
            {error && <p className="text-sm text-destructive text-center">{error}</p>}
            <Button type="submit" className="w-full h-11" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verificar e Entrar'}
            </Button>
            <div className="flex flex-col gap-2 pt-2 text-center">
              <button
                type="button"
                onClick={handleResend}
                className="text-xs text-muted-foreground hover:text-foreground active:scale-95 transition-all"
              >
                Não recebeu o código? <span className="font-semibold text-primary hover:underline">Reenviar código</span>
              </button>
              <button
                type="button"
                onClick={() => setStep('register')}
                className="text-xs text-accent hover:underline font-semibold active:scale-95 transition-all mt-1"
              >
                Voltar / Alterar e-mail
              </button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
