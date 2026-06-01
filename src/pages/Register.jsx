import { useState } from 'react';
import { base44 } from '@/lib/localDb';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Factory, Loader2 } from 'lucide-react';
import LeoLogo from '@/components/ui/LeoLogo';

export default function Register() {
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
      const res = await base44.auth.verifyOtp({ email, otpCode: otp });
      const token = res?.access_token || res?.data?.access_token;
      if (token) base44.auth.setToken(token);
      window.location.href = '/';
    } catch (err) {
      setError(err?.message || 'Código inválido.');
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    try { await base44.auth.resendOtp(email); } catch (err) { setError(err?.message || 'Erro ao reenviar.'); }
  };

  const handleGoogle = () => base44.auth.loginWithProvider('google', '/');

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
              <Input id="otp" value={otp} onChange={(e) => setOtp(e.target.value)} required placeholder="000000" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verificar'}
            </Button>
            <button type="button" onClick={handleResend} className="w-full text-sm text-muted-foreground hover:text-foreground">
              Reenviar código
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}