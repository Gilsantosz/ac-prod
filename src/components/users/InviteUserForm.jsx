import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Check, Loader2, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCells } from '@/hooks/useCells';
import { SYSTEM_ROLE_OPTIONS, getRoleDefaultPermissions } from '@/lib/roleProfiles';
import PageAccessMatrix, { normalizePagePermissions } from '@/components/users/PageAccessMatrix';

export default function InviteUserForm({ onInvite, saving }) {
  const { activeCells } = useCells();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('operator');
  const [managedCells, setManagedCells] = useState([]);
  const [permissions, setPermissions] = useState(() => getRoleDefaultPermissions('operator'));
  const [reportDeliveryEnabled, setReportDeliveryEnabled] = useState(false);
  const [receivesDailyReport, setReceivesDailyReport] = useState(false);

  useEffect(() => {
    setPermissions(getRoleDefaultPermissions(role));
  }, [role]);

  const toggleCell = (cellName) => {
    setManagedCells((current) => current.includes(cellName)
      ? current.filter((nameValue) => nameValue !== cellName)
      : [...current, cellName]);
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

    await onInvite(
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

    setName('');
    setEmail('');
    setPassword('');
    setRole('operator');
    setManagedCells([]);
    setPermissions(getRoleDefaultPermissions('operator'));
    setReportDeliveryEnabled(false);
    setReceivesDailyReport(false);
  };

  return (
    <Card className="space-y-6 border-border/60 p-6 shadow-sm">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Criar novo usuário</h3>
        <p className="text-sm text-muted-foreground">Cadastre colaboradores, incluindo o papel Qualidade, e configure o escopo de acesso.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="invite-name">Nome completo</Label>
            <Input id="invite-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="ex.: Carlos Silva" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-email">E-mail de acesso</Label>
            <Input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ex.: carlos@empresa.com" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-password">Senha de acesso</Label>
            <Input id="invite-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="mínimo 8 caracteres" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Papel</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="invite-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SYSTEM_ROLE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-border/60 p-4">
          <div>
            <Label className="text-sm font-semibold">Células autorizadas</Label>
            <p className="text-xs text-muted-foreground">O escopo também limita decisões de Qualidade e Reposição.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {activeCells.map((cell) => {
              const active = managedCells.includes(cell.name);
              return (
                <button
                  type="button"
                  key={cell.id}
                  onClick={() => toggleCell(cell.name)}
                  className={cn('flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors', active ? 'border-primary bg-primary/5 font-semibold text-foreground' : 'border-border/60 text-muted-foreground hover:bg-muted/40')}
                >
                  <span>{cell.name}</span>
                  <span className={cn('flex h-4 w-4 items-center justify-center rounded border', active && 'border-primary bg-primary text-primary-foreground')}>
                    {active && <Check className="h-3 w-3" />}
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
              className="mt-1 h-4 w-4 rounded border-input text-primary"
            />
            <span><span className="block text-sm font-semibold text-foreground">Disponível para e-mails e comandos da IA</span><span className="block text-xs text-muted-foreground">Permite selecionar este colaborador como destinatário de relatórios.</span></span>
          </label>
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={receivesDailyReport} disabled={!reportDeliveryEnabled} onChange={(event) => setReceivesDailyReport(event.target.checked)} className="mt-1 h-4 w-4 rounded border-input text-primary disabled:opacity-50" />
            <span><span className="block text-sm font-semibold text-foreground">Destinatário de fechamento produtivo</span><span className="block text-xs text-muted-foreground">O horário e o conteúdo são definidos na aba Agendamentos.</span></span>
          </label>
        </div>

        <PageAccessMatrix role={role} permissions={permissions} onChange={setPermissions} disabled={role === 'admin'} />

        <div className="flex justify-end border-t border-border/40 pt-2">
          <Button type="submit" disabled={saving} className="gap-2 px-6">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Criar usuário
          </Button>
        </div>
      </form>
    </Card>
  );
}
