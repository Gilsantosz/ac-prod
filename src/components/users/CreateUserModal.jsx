import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Loader2, UserPlus, Check, Eye, EyeOff, ShieldCheck, Mail, User, Lock, Layers
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCells } from '@/hooks/useCells';
import { getDefaultPermissions } from '@/config/appRoutes';
import PageAccessMatrix, { normalizePagePermissions } from '@/components/users/PageAccessMatrix';

export default function CreateUserModal({ open, onOpenChange, onInvite, saving }) {
  const { activeCells } = useCells();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState('operator');
  const [managedCells, setManagedCells] = useState([]);
  const [permissions, setPermissions] = useState(() => getDefaultPermissions('operator'));
  const [reportDeliveryEnabled, setReportDeliveryEnabled] = useState(false);
  const [receivesDailyReport, setReceivesDailyReport] = useState(false);

  // Atualiza as permissões automaticamente quando o papel muda
  useEffect(() => {
    setPermissions(getDefaultPermissions(role));
  }, [role]);

  const toggleCell = (cellName) => {
    setManagedCells((current) => (
      current.includes(cellName)
        ? current.filter((name) => name !== cellName)
        : [...current, cellName]
    ));
  };

  const resetForm = () => {
    setName('');
    setEmail('');
    setPassword('');
    setShowPassword(false);
    setRole('operator');
    setManagedCells([]);
    setPermissions(getDefaultPermissions('operator'));
    setReportDeliveryEnabled(false);
    setReceivesDailyReport(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password.trim()) return;

    if (password.trim().length < 8) {
      alert("A senha de acesso deve ter pelo menos 8 caracteres.");
      return;
    }
    if (role === 'operator' && managedCells.length === 0) {
      alert('Selecione pelo menos uma célula autorizada para o operador.');
      return;
    }

    const created = await onInvite(
      email.trim().toLowerCase(),
      role,
      name.trim(),
      password.trim(),
      normalizePagePermissions(permissions, role),
      managedCells[0] || '',
      managedCells,
      {
        report_delivery_enabled: reportDeliveryEnabled,
        receives_daily_report: receivesDailyReport,
      },
    );

    if (created) {
      resetForm();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(val) => {
      if (!val) resetForm();
      onOpenChange(val);
    }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-6 border-border/80 shadow-2xl rounded-2xl">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" /> Cadastrar Novo Usuário
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Preencha os dados e defina as permissões de acesso às páginas do sistema. O modal será fechado automaticamente após a conclusão.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 pt-2">
          {/* Informações Pessoais e Acesso */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="create-name" className="text-xs font-semibold flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-muted-foreground" /> Nome Completo
              </Label>
              <Input
                id="create-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex: Carlos Silva"
                required
                className="h-10 text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-email" className="text-xs font-semibold flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" /> E-mail (Login do Usuário)
              </Label>
              <Input
                id="create-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ex: carlos@empresa.com"
                required
                className="h-10 text-sm font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-password" className="text-xs font-semibold flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-muted-foreground" /> Senha de Acesso
              </Label>
              <div className="relative">
                <Input
                  id="create-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="mínimo 8 caracteres"
                  required
                  className="h-10 text-sm pr-10 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-role" className="text-xs font-semibold flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground" /> Papel no Sistema
              </Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="create-role" className="h-10 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="operator">Operador / Usuário</SelectItem>
                  <SelectItem value="supervisor">Supervisor / Líder</SelectItem>
                  <SelectItem value="manager">Gestor</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="viewer">Visualizador / Auditor</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Células Autorizadas */}
          <div className="space-y-3 rounded-xl border border-border/60 p-4 bg-secondary/10">
            <div>
              <Label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-primary" /> Células Autorizadas
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Selecione as células que este usuário terá acesso para monitorar e lançar produção.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {activeCells.map((c) => {
                const active = managedCells.includes(c.name);
                return (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => toggleCell(c.name)}
                    className={cn(
                      'flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition-colors',
                      active ? 'border-primary bg-primary/10 font-semibold text-foreground' : 'border-border/60 text-muted-foreground hover:bg-muted/40',
                    )}
                  >
                    <span>{c.name}</span>
                    <span className={cn('flex h-3.5 w-3.5 items-center justify-center rounded border', active && 'border-primary bg-primary text-primary-foreground')}>
                      {active && <Check className="h-2.5 w-2.5" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Relatórios e IA */}
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-border/60 bg-muted/20 p-4 sm:grid-cols-2">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={reportDeliveryEnabled}
                onChange={(event) => {
                  setReportDeliveryEnabled(event.target.checked);
                  if (!event.target.checked) setReceivesDailyReport(false);
                }}
                className="mt-0.5 h-4 w-4 rounded border-input text-primary"
              />
              <span>
                <span className="block text-xs font-semibold text-foreground">Disponível para E-mails e Comandos da IA</span>
                <span className="block text-[11px] text-muted-foreground">Permite selecionar este e-mail como destinatário de relatórios.</span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={receivesDailyReport}
                disabled={!reportDeliveryEnabled}
                onChange={(event) => setReceivesDailyReport(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-input text-primary disabled:opacity-50"
              />
              <span>
                <span className="block text-xs font-semibold text-foreground">Destinatário de Fechamento Produtivo</span>
                <span className="block text-[11px] text-muted-foreground">Horário e formato definidos na aba Agendamentos.</span>
              </span>
            </label>
          </div>

          {/* Matriz de Permissões por Página */}
          <div className="pt-2">
            <PageAccessMatrix
              role={role}
              permissions={permissions}
              onChange={setPermissions}
              disabled={role === 'admin'}
            />
          </div>

          {/* Botões de Ação do Modal */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border/40">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={saving}
              className="gap-2 text-xs px-6 font-bold bg-primary text-primary-foreground shadow-md"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Cadastrar Usuário
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
