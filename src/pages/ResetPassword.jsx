import { useState } from 'react';
import { base44 } from '@/lib/localDb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Factory, Loader2 } from 'lucide-react';
import LeoLogo from '@/components/ui/LeoLogo';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const resetToken = new URLSearchParams(window.location.search).get('token');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('As senhas não coincidem.'); return; }
    setLoading(true);
    try {
      await base44.auth.resetPassword({ resetToken, newPassword: password });
      window.location.href = '/login';
    } catch (err) {
      setError(err?.message || 'Falha ao redefinir a senha.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md p-8 shadow-xl border-border/60">
        <div className="flex flex-col items-center mb-8">
          <LeoLogo size="lg" className="mb-4" />
          <h1 className="text-2xl font-bold">Nova senha</h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Nova senha</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirmar senha</Label>
            <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Redefinir senha'}
          </Button>
        </form>
      </Card>
    </div>
  );
}