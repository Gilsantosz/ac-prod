import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import LeoLogo from '@/components/ui/LeoLogo';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      // navigate() do React Router respeita o basename /ac-prod/ automaticamente
      // Não usar window.location.href que causa 404 no dev e GitHub Pages
      navigate('/', { replace: true });
    } catch (err) {
      setError(err?.message || 'Falha ao entrar. Verifique suas credenciais.');
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    try {
      const { supabase } = await import('@/lib/supabaseClient');
      const base = import.meta.env.BASE_URL || '/ac-prod/';
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}${base}` },
      });
    } catch {
      setError('Falha ao iniciar login com Google.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 shadow-xl border-border/60">
        <div className="flex flex-col items-center mb-8">
          <LeoLogo size="lg" className="mb-4" />
          <h1 className="text-2xl font-bold">AC. Produção</h1>
          <p className="text-muted-foreground text-sm mt-1">Painel de Produção Industrial</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="voce@empresa.com"
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Entrar'}
          </Button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-card px-2 text-muted-foreground">ou</span>
          </div>
        </div>

        <Button variant="outline" className="w-full" onClick={handleGoogle}>
          Continuar com Google
        </Button>

        <div className="flex items-center justify-between mt-6 text-sm">
          <Link to="/forgot-password" className="text-muted-foreground hover:text-foreground">
            Esqueceu a senha?
          </Link>
          <Link to="/register" className="text-accent font-medium hover:underline">
            Criar conta
          </Link>
        </div>
      </Card>
    </div>
  );
}