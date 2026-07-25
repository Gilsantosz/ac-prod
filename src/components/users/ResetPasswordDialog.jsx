import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { KeyRound, Eye, EyeOff, Sparkles, Send, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';

function generateRandomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const specials = '@#$%!';
  let pass = 'LeoFlow@';
  for (let i = 0; i < 4; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  pass += Math.floor(10 + Math.random() * 90);
  pass += specials.charAt(Math.floor(Math.random() * specials.length));
  return pass;
}

export default function ResetPasswordDialog({ user, open, onClose, onDirectReset, onSendResetEmail }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  if (!user) return null;

  const handleGenerate = () => {
    const generated = generateRandomPassword();
    setNewPassword(generated);
    setConfirmPassword(generated);
    setShowPassword(true);
    toast.info(`Senha gerada: ${generated}`);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!newPassword) {
      toast.error('Informe a nova senha.');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('A senha deve conter no mínimo 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('As senhas não coincidem.');
      return;
    }

    setSaving(true);
    try {
      await onDirectReset(user.id, newPassword);
      toast.success(`Senha de ${user.name || user.email} redefinida com sucesso!`);
      setNewPassword('');
      setConfirmPassword('');
      setShowPassword(false);
      onClose();
    } catch (err) {
      toast.error(err?.message || 'Falha ao redefinir a senha do usuário.');
    } finally {
      setSaving(false);
    }
  };

  const handleSendEmail = async () => {
    setSendingEmail(true);
    try {
      await onSendResetEmail(user.email);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSendingEmail(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="sm:max-w-md rounded-2xl p-6 border-border/80 shadow-2xl bg-card">
        <DialogHeader className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">Redefinir Senha do Colaborador</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Defina uma nova senha diretamente na própria página para <span className="font-semibold text-foreground">{user.name || user.email}</span>.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 pt-2">
          {/* Informações do usuário */}
          <div className="p-3 bg-muted/40 rounded-xl border border-border/60 text-xs space-y-1">
            <p className="font-semibold text-foreground">{user.name || 'Sem Nome'}</p>
            <p className="text-muted-foreground font-mono">{user.email}</p>
          </div>

          {/* Nova Senha */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="new-password">Nova Senha</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 text-[11px] font-bold text-primary hover:text-primary/80 gap-1 px-2"
                onClick={handleGenerate}
              >
                <Sparkles className="w-3 h-3" />
                Gerar Senha Forte
              </Button>
            </div>
            <div className="relative">
              <Input
                id="new-password"
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="No mínimo 8 caracteres"
                className="pr-10 font-mono text-sm"
                required
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Confirmar Nova Senha */}
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirmar Nova Senha</Label>
            <Input
              id="confirm-password"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Digite novamente a nova senha"
              className="font-mono text-sm"
              required
            />
            {confirmPassword && newPassword === confirmPassword && (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <Check className="w-3 h-3" /> Senhas coincidem
              </p>
            )}
          </div>

          <DialogFooter className="pt-2 flex flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSendEmail}
              disabled={sendingEmail || saving}
              className="w-full sm:w-auto text-xs gap-1.5"
              title="Enviar e-mail para o usuário redefinir por conta própria"
            >
              {sendingEmail ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5 text-muted-foreground" />}
              <span>Enviar Link por E-mail</span>
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={saving || sendingEmail}
              className="w-full sm:w-auto text-xs font-bold gap-1.5 px-4 bg-primary text-primary-foreground"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
              <span>Salvar Nova Senha</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
