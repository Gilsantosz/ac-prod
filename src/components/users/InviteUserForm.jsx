import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Loader2, UserPlus, LayoutDashboard, PlusCircle, AlertOctagon, Boxes, HardHat, LineChart,
  Zap, Users, ShieldAlert, BrainCircuit, Plug, GitFork, Box, Truck, BellRing, Layers, Edit3
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCells } from '@/hooks/useCells';
import { getDefaultPermissions } from '@/config/appRoutes';


const PERMISSION_METADATA = [
  { key: 'view_dashboards', label: 'Visualizar Painéis', desc: 'Painéis, OEE, Tendências e Gamificação.', icon: LayoutDashboard },
  { key: 'register_production', label: 'Lançar Produção', desc: 'Registrar apontamentos horários.', icon: PlusCircle },
  { key: 'register_manual_production', label: 'Baixa Manual', desc: 'Registrar baixas produtivas manuais por Lote Geral.', icon: Edit3 },
  { key: 'manage_occurrences', label: 'Ocorrências e Paradas', desc: 'Registrar e tratar paradas da produção.', icon: AlertOctagon },
  { key: 'manage_cells', label: 'Células e Metas', desc: 'Cadastrar células de trabalho e metas diárias.', icon: Boxes },
  { key: 'manage_operators', label: 'Operadores e Equipes', desc: 'Gerenciar cadastro de operadores.', icon: HardHat },
  { key: 'view_reports', label: 'Relatórios Industriais', desc: 'Acessar e exportar relatórios em PDF.', icon: LineChart },
  { key: 'ai_operations', label: 'IA Operacional', desc: 'Consultar o Copilot e gerar análises produtivas.', icon: BrainCircuit },
  { key: 'manage_automations', label: 'Alertas e Automações', desc: 'Configurar automações e regras de alerta.', icon: Zap },
  { key: 'manage_users', label: 'Gerenciar Usuários', desc: 'Cadastrar usuários e configurar acessos.', icon: Users, warning: true },
  { key: 'view_pcp', label: 'Visualizar PCP', desc: 'Acessar o portal de PCP e importação de XML/CSV.', icon: Plug },
  { key: 'manage_pcp', label: 'Gerenciar PCP', desc: 'Gerenciar importações e configurações do PCP.', icon: Plug },
  { key: 'manage_routes', label: 'Gerenciar Rotas', desc: 'Configurar templates de roteiros produtivos.', icon: GitFork },
  { key: 'traceability_collect', label: 'Coleta / Bipagem', desc: 'Registrar peças no coletor de código/RFID.', icon: PlusCircle },
  { key: 'view_traceability', label: 'Rastreabilidade Geral', desc: 'Acessar o Kanban e timeline de peças.', icon: Layers },
  { key: 'manage_packaging', label: 'Gerenciar Embalagem', desc: 'Criar volumes e bipar peças (Scan-to-Pack).', icon: Box },
  { key: 'manage_shipping', label: 'Gerenciar Expedição', desc: 'Realizar checklist de remessas e expedição.', icon: Truck },
  { key: 'view_mes_alerts', label: 'Alertas MES', desc: 'Visualizar atrasos e gargalos no chão de fábrica.', icon: BellRing },
  // Novas permissões
  { key: 'send_reports', label: 'Enviar Relatórios', desc: 'Enviar fechamentos e relatórios por e-mail manualmente.', icon: BellRing },
  { key: 'schedule_reports', label: 'Agendar Relatórios', desc: 'Configurar e-mails automáticos periódicos.', icon: Zap },
  { key: 'manage_report_recipients', label: 'Gerenciar Destinatários', desc: 'Cadastrar grupos de e-mail e contatos.', icon: Users },
  { key: 'view_report_delivery_logs', label: 'Histórico de Envios', desc: 'Visualizar logs de e-mails enviados.', icon: LineChart },
  { key: 'manage_email_settings', label: 'Configurar E-mail', desc: 'Configurar SMTP/Resend e cron (Admin).', icon: Users, warning: true },
  { key: 'view_audit_logs', label: 'Logs de Auditoria', desc: 'Visualizar logs de auditoria de sistema (Admin).', icon: ShieldAlert, warning: true }
];

export default function InviteUserForm({ onInvite, saving }) {
  const { activeCells } = useCells();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('operator');
  const [cell, setCell] = useState('none');
  const [permissions, setPermissions] = useState(() => getDefaultPermissions('operator'));
  const [reportDeliveryEnabled, setReportDeliveryEnabled] = useState(false);
  const [receivesDailyReport, setReceivesDailyReport] = useState(false);

  // Atualiza as permissões automaticamente quando o papel muda
  useEffect(() => {
    setPermissions(getDefaultPermissions(role));
  }, [role]);

  const togglePermission = (key) => {
    setPermissions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !password.trim()) return;

    if (password.trim().length < 8) {
      alert("A senha de acesso deve ter pelo menos 8 caracteres.");
      return;
    }

    await onInvite(
      email.trim(),
      role,
      name.trim(),
      password.trim(),
      permissions,
      cell === 'none' ? '' : cell,
      {
        report_delivery_enabled: reportDeliveryEnabled,
        receives_daily_report: receivesDailyReport,
      },
    );
    
    // Limpar campos
    setName('');
    setEmail('');
    setPassword('');
    setRole('operator');
    setCell('none');
    setPermissions(getDefaultPermissions('operator'));
    setReportDeliveryEnabled(false);
    setReceivesDailyReport(false);
  };

  return (
    <Card className="p-6 border-border/60 space-y-6 shadow-sm">
      <div>
        <h3 className="font-semibold text-lg text-foreground">Criar Novo Usuário</h3>
        <p className="text-sm text-muted-foreground">Cadastre novos colaboradores e configure permissões granulares de acesso.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="space-y-2 md:col-span-1">
            <Label htmlFor="name">Nome Completo</Label>
            <Input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Carlos Silva" required />
          </div>
          <div className="space-y-2 md:col-span-1">
            <Label htmlFor="email">E-mail (Login)</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ex: carlos@empresa.com" required />
          </div>
          <div className="space-y-2 md:col-span-1">
            <Label htmlFor="password">Senha de Acesso</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mínimo 8 caracteres" required />
          </div>
          <div className="space-y-2 md:col-span-1">
            <Label htmlFor="role">Papel</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="operator">Operador / Usuário</SelectItem>
                <SelectItem value="supervisor">Supervisor / Líder</SelectItem>
                <SelectItem value="manager">Gestor</SelectItem>
                <SelectItem value="admin">Administrador</SelectItem>
                <SelectItem value="viewer">Visualizador / Auditor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-1">
            <Label htmlFor="cell">Célula Vinculada</Label>
            <Select value={cell} onValueChange={setCell}>
              <SelectTrigger id="cell"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhuma (Admin / Outra)</SelectItem>
                {activeCells.map((c) => (
                  <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <span>
              <span className="block text-sm font-semibold text-foreground">Disponível para e-mails e comandos da IA</span>
              <span className="block text-xs text-muted-foreground">Permite selecionar este colaborador como destinatário de relatórios.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={receivesDailyReport}
              disabled={!reportDeliveryEnabled}
              onChange={(event) => setReceivesDailyReport(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-input text-primary disabled:opacity-50"
            />
            <span>
              <span className="block text-sm font-semibold text-foreground">Destinatário de fechamento produtivo</span>
              <span className="block text-xs text-muted-foreground">O horário e o conteúdo são definidos na aba Agendamentos.</span>
            </span>
          </label>
        </div>



        <div className="space-y-3">
          <Label className="text-sm font-semibold flex items-center gap-1.5 text-foreground">
            Permissões Granulares de Acesso
          </Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {PERMISSION_METADATA.map((p) => {
              const Icon = p.icon;
              const active = permissions[p.key];
              return (
                <div
                  key={p.key}
                  onClick={() => togglePermission(p.key)}
                  className={cn(
                    "p-3.5 rounded-xl border cursor-pointer select-none transition-all duration-200 flex flex-col gap-2 relative overflow-hidden",
                    active
                      ? "border-primary bg-primary/5 hover:bg-primary/10 shadow-sm"
                      : "border-border/60 bg-card hover:bg-secondary/40",
                    p.warning && active && "border-amber-500/50 bg-amber-500/5 hover:bg-amber-500/10"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                      active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                      p.warning && active && "bg-amber-500/20 text-amber-500"
                    )}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className={cn(
                      "w-5 h-5 rounded-full border flex items-center justify-center transition-all duration-200",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/30 bg-transparent",
                      p.warning && active && "border-amber-500 bg-amber-500"
                    )}>
                      {active && (
                        <svg className="w-3.5 h-3.5 stroke-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                      {p.label}
                      {p.warning && (
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-normal">{p.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-border/40">
          <Button type="submit" disabled={saving} className="gap-2 px-6">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Criar Usuário
          </Button>
        </div>
      </form>
    </Card>
  );
}
