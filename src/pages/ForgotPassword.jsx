import { useState } from 'react';
import { base44 } from '@/lib/localDb';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Factory, Loader2 } from 'lucide-react';
import LeoLogo from '@/components/ui/LeoLogo';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try { await base44.auth.resetPasswordRequest(email); } catch (_) { /* ignore */ }
    setSent(true);
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 shadow-xl border-border/60">
        <div className="flex flex-col items-center mb-8">
          <LeoLogo size="lg" className="mb-4" />
          <h1 className="text-2xl font-bold">Recuperar senha</h1>
        </div>
        {sent ? (
          <p className="text-center text-sm text-muted-foreground">
            Se este e-mail estiver cadastrado, você receberá um link para redefinir sua senha.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enviar link'}
            </Button>
          </form>
        )}
        <p className="text-center text-sm mt-6">
          <Link to="/login" className="text-accent font-medium hover:underline">Voltar ao login</Link>
        </p>
      </Card>
    </div>
  );
}