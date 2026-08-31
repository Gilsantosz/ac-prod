import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Check,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  User,
  UserPlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCells } from '@/hooks/useCells';
import {
  SYSTEM_ROLE_OPTIONS,
  creatorAuthorityRank,
  getRoleDefaultPermissions,
  normalizeSystemRole,
} from '@/lib/roleProfiles';
import PageAccessMatrix, { normalizePagePermissions } from '@/components/users/PageAccessMatrix';

export default function CreateUserModal({ open, onOpenChange, onInvite, saving, creator }) {
  const { activeCells } = useCells();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState('operator');
  const [managedCells, setManagedCells] = useState([]);
  const [permissions, setPermissions] = useState(() => getRoleDefaultPermissions('operator'));
  const [reportDeliveryEnabled, setReportDeliveryEnabled] = useState(false);
  const [receivesDailyReport, setReceivesDailyReport] = useState(false);

  const availableRoles = useMemo(() => {
    if (normalizeSystemRole(creator?.role) === 'admin') return SYSTEM_ROLE_OPTIONS;
    const rank = creatorAuthorityRank(creator);
    return SYSTEM_ROLE_OPTIONS.filter((option) => option.rank < rank);
  }, [creator]);

  const creatorCells = creator?.managed_cells?.length
    ? creator.managed_cells
    : creator?.cell ? [creator.cell] : [];
  const availableCells = normalizeSystemRole(creator?.role) === 'admin' || creatorCells.length === 0
    ? activeCells
    : activeCells.filter((cellOption) => creatorCells.includes(cellOption.name));

  useEffect(() => {
    setPermissions(getRoleDefaultPermissions(role));
  }, [role]);

  useEffect(() => {
    if (!availableRoles.some((option) => option.value === role)) {
      setRole(availableRoles[0]?.value || 'operator');
    }
  }, [availableRoles, role]);

  const toggleCell = (cellName) => {
    setManagedCells((current) => (
      current.includes(cellName)
        ? current.filter((value) => value !== cellName)
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
    setPermissions(getRoleDefaultPermissions('operator'));
    setReportDeliveryEnabled(false);
    setReceivesDailyReport(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!name.trim() || !email.trim() || !password.trim()) return;
    if (password.trim().length < 8) {
      alert('A senha de acesso deve ter pelo menos 8 caracteres.');
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
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) resetForm();
        onOpenChange(value);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-2xl border-border/80 p-6 shadow-2xl">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-xl font-bold text-foreground">
            <UserPlus className="h-5 w-5 text-primary" /> Cadastrar novo usuário
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Defina o papel, o escopo de células e as permissões do colaborador. O papel Qualidade possui autoridade de reposição e gestão de não conformidades.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 pt-2">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="create-name" className="flex items-center gap-1.5 text-xs font-semibold">
                <User className="h-3.5 w-3.5 text-muted-foreground" /> Nome completo
              </Label>
              <Input id="create-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="ex.: Carlos Silva" required className="h-10 text-sm" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-email" className="flex items-center gap-1.5 text-xs font-semibold">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" /> E-mail de acesso
              </Label>
              <Input id="create-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ex.: carlos@empresa.com" required className="h-10 font-mono text-sm" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-password" className="flex items-center gap-1.5 text-xs font-semibold">
                <Lock className="h-3.5 w-3.5 text-muted-foreground" /> Senha de acesso
              </Label>
              <div className="relative">
                <Input id="create-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="mínimo 8 caracteres" required className="h-10 pr-10 font-mono text-sm" />
                <button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-role" className="flex items-center gap-1.5 text-xs font-semibold">
                <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" /> Papel no sistema
              </Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="create-role" className="h-10 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {availableRoles.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {role === 'quality_manager' && (
                <p className="text-[11px] text-muted-foreground">Qualidade pode aprovar e concluir reposições com justificativa, sem administrar usuários.</p>
              )}
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-border/60 bg-secondary/10 p-4">
            <div>
              <Label className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                <Layers className="h-3.5 w-3.5 text-primary" /> Células autorizadas
              </Label>
              <p className="text-[11px] text-muted-foreground">O escopo limita consultas e decisões às células selecionadas. Sem seleção, papéis de gestão mantêm escopo global.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {availableCells.map((cell) => {
                const active = managedCells.includes(cell.name);
                return (
                  <button
                    type="button"
                    key={cell.id}
                    onClick={() => toggleCell(cell.name)}
                    className={cn(
                      'flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition-colors',
                      active ? 'border-primary bg-primary/10 font-semibold text-foreground' : 'border-border/60 text-muted-foreground hover:bg-muted/40',
                    )}
                  >
                    <span>{cell.name}</span>
                    <span className={cn('flex h-3.5 w-3.5 items-center justify-center rounded border', active && 'border-primary bg-primary text-primary-foreground')}>
                      {active && <Check className="h-2.5 w-2.5" />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

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
                <span className="block text-xs font-semibold text-foreground">Disponível para e-mails e comandos da IA</span>
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
                <span className="block text-xs font-semibold text-foreground">Destinatário de fechamento produtivo</span>
                <span className="block text-[11px] text-muted-foreground">Horário e formato definidos na aba Agendamentos.</span>
              </span>
            </label>
          </div>

          <div className="pt-2">
            <PageAccessMatrix
              role={role}
              permissions={permissions}
              onChange={setPermissions}
              disabled={role === 'admin' || normalizeSystemRole(creator?.role) !== 'admin'}
            />
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border/40 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="text-xs">Cancelar</Button>
            <Button type="submit" disabled={saving} className="gap-2 bg-primary px-6 text-xs font-bold text-primary-foreground shadow-md">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Cadastrar usuário
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
