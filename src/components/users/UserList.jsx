import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  User as UserIcon, Edit3, Trash2, Save, X, LayoutDashboard, PlusCircle, AlertOctagon,
  Boxes, HardHat, LineChart, Zap, Users, KeyRound, Send, BrainCircuit,
  Plug, GitFork, Box, Truck, BellRing, Layers, ShieldAlert, MailCheck
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCells } from '@/hooks/useCells';
import { getDefaultPermissions } from '@/config/appRoutes';


const PERMISSION_LABELS = {
  view_dashboards: 'Painéis',
  register_production: 'Apontamentos',
  manage_occurrences: 'Ocorrências',
  manage_cells: 'Células/Metas',
  manage_operators: 'Operadores',
  view_reports: 'Relatórios',
  ai_operations: 'IA Operacional',
  manage_automations: 'Automações',
  manage_users: 'Usuários',
  view_pcp: 'Visualizar PCP',
  manage_pcp: 'Gerenciar PCP',
  manage_routes: 'Rotas MES',
  traceability_collect: 'Bipagem / Coleta',
  view_traceability: 'Rastreabilidade',
  manage_packaging: 'Embalagem',
  manage_shipping: 'Expedição',
  view_mes_alerts: 'Alertas MES',
  // Novas permissões
  send_reports: 'Enviar Relatórios',
  schedule_reports: 'Agendar Relatórios',
  manage_report_recipients: 'Gerenciar Destinatários',
  view_report_delivery_logs: 'Histórico de Envios',
  manage_email_settings: 'Configurar E-mail',
  view_audit_logs: 'Logs de Auditoria'
};


const PERMISSION_METADATA = [
  { key: 'view_dashboards', label: 'Painéis', icon: LayoutDashboard },
  { key: 'register_production', label: 'Apontamentos', icon: PlusCircle },
  { key: 'manage_occurrences', label: 'Ocorrências', icon: AlertOctagon },
  { key: 'manage_cells', label: 'Células/Metas', icon: Boxes },
  { key: 'manage_operators', label: 'Operadores', icon: HardHat },
  { key: 'view_reports', label: 'Relatórios', icon: LineChart },
  { key: 'ai_operations', label: 'IA Operacional', icon: BrainCircuit },
  { key: 'manage_automations', label: 'Automações', icon: Zap },
  { key: 'manage_users', label: 'Usuários', icon: Users, warning: true },
  { key: 'view_pcp', label: 'Visualizar PCP', icon: Plug },
  { key: 'manage_pcp', label: 'Gerenciar PCP', icon: Plug },
  { key: 'manage_routes', label: 'Rotas MES', icon: GitFork },
  { key: 'traceability_collect', label: 'Bipagem / Coleta', icon: PlusCircle },
  { key: 'view_traceability', label: 'Rastreabilidade', icon: Layers },
  { key: 'manage_packaging', label: 'Embalagem', icon: Box },
  { key: 'manage_shipping', label: 'Expedição', icon: Truck },
  { key: 'view_mes_alerts', label: 'Alertas MES', icon: BellRing },
  // Novas permissões
  { key: 'send_reports', label: 'Enviar Relatórios', icon: BellRing },
  { key: 'schedule_reports', label: 'Agendar Relatórios', icon: Zap },
  { key: 'manage_report_recipients', label: 'Gerenciar Destinatários', icon: Users },
  { key: 'view_report_delivery_logs', label: 'Histórico de Envios', icon: LineChart },
  { key: 'manage_email_settings', label: 'Configurar E-mail', icon: Users, warning: true },
  { key: 'view_audit_logs', label: 'Logs de Auditoria', icon: ShieldAlert, warning: true }
];



export default function UserList({ users, currentUserId, onUpdate, onDelete, onResetPassword, onResendInvite }) {
  if (!users.length) {
    return (
      <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl">
        Nenhum usuário encontrado.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-lg text-foreground">Colaboradores Cadastrados</h3>
      <div className="space-y-3">
        {users.map((u) => (
          <UserCard
            key={u.id}
            user={u}
            currentUserId={currentUserId}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onResetPassword={onResetPassword}
            onResendInvite={onResendInvite}
          />
        ))}
      </div>
    </div>
  );
}

function UserCard({ user, currentUserId, onUpdate, onDelete, onResetPassword, onResendInvite }) {
  const { activeCells } = useCells();
  const [isEditing, setIsEditing] = useState(false);
  
  // States para edição
  const [editName, setEditName] = useState(user.name || '');
  const [editRole, setEditRole] = useState(user.role || 'operator');
  const [editCell, setEditCell] = useState(user.cell || 'none');
  const [editPermissions, setEditPermissions] = useState(() => user.permissions || getDefaultPermissions(user.role || 'operator'));
  const [editReportDelivery, setEditReportDelivery] = useState(Boolean(user.report_delivery_enabled));
  const [editDailyReport, setEditDailyReport] = useState(Boolean(user.receives_daily_report));


  const isSelf = user.id === currentUserId;

  const togglePermission = (key) => {
    setEditPermissions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSave = async () => {
    if (!editName.trim()) return;
    
    // 1. Atualizar Usuário
    await onUpdate(user.id, {
      name: editName.trim(),
      role: editRole,
      cell: editCell === 'none' ? '' : editCell, // Enviando a célula vinculada no payload
      permissions: editPermissions,
      report_delivery_enabled: editReportDelivery,
      receives_daily_report: editReportDelivery && editDailyReport,
    });

    setIsEditing(false);
  };

  const handleCancel = () => {
    // Resetar formulário
    setEditName(user.name || '');
    setEditRole(user.role || 'operator');
    setEditCell(user.cell || 'none');
    setEditPermissions(user.permissions || getDefaultPermissions(user.role || 'operator'));
    setEditReportDelivery(Boolean(user.report_delivery_enabled));
    setEditDailyReport(Boolean(user.receives_daily_report));

    setIsEditing(false);
  };

  return (
    <Card className={cn(
      "border transition-all duration-200 shadow-sm",
      isEditing ? "border-primary p-6 bg-card" : "border-border/60 p-4 hover:border-border"
    )}>
      {isEditing ? (
        // Modo de Edição
        <div className="space-y-5">
          <div className="flex items-center justify-between border-b border-border/40 pb-3">
            <h4 className="font-semibold text-foreground flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-primary" />
              Editar Colaborador
            </h4>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleCancel} className="gap-1.5">
                <X className="w-3.5 h-3.5" /> Cancelar
              </Button>
              <Button size="sm" onClick={handleSave} className="gap-1.5 px-4">
                <Save className="w-3.5 h-3.5" /> Salvar
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Nome Completo</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Papel</Label>
              <Select value={editRole} onValueChange={setEditRole} disabled={isSelf}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="operator">Operador / Usuário</SelectItem>
                  <SelectItem value="supervisor">Supervisor / Líder</SelectItem>
                  <SelectItem value="manager">Gestor</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="viewer">Visualizador / Auditor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Célula Vinculada</Label>
              <Select value={editCell} onValueChange={setEditCell}>
                <SelectTrigger><SelectValue /></SelectTrigger>
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
                checked={editReportDelivery}
                onChange={(event) => {
                  setEditReportDelivery(event.target.checked);
                  if (!event.target.checked) setEditDailyReport(false);
                }}
                className="mt-1 h-4 w-4 rounded border-input text-primary"
              />
              <span>
                <span className="block text-sm font-semibold">Disponível para relatórios e IA</span>
                <span className="block text-xs text-muted-foreground">Pode ser selecionado como destinatário.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={editDailyReport}
                disabled={!editReportDelivery}
                onChange={(event) => setEditDailyReport(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-input text-primary disabled:opacity-50"
              />
              <span>
                <span className="block text-sm font-semibold">Fechamento produtivo</span>
                <span className="block text-xs text-muted-foreground">Horário configurado na aba Agendamentos.</span>
              </span>
            </label>
          </div>



          <div className="space-y-3">
            <Label className="text-sm font-semibold text-foreground">Permissões de Acesso</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PERMISSION_METADATA.map((p) => {
                const Icon = p.icon;
                const active = editPermissions[p.key];
                return (
                  <div
                    key={p.key}
                    onClick={() => togglePermission(p.key)}
                    className={cn(
                      "p-2.5 rounded-lg border cursor-pointer select-none transition-all flex items-center gap-2",
                      active
                        ? "border-primary/50 bg-primary/5 text-foreground font-medium"
                        : "border-border/40 bg-card hover:bg-secondary/30 text-muted-foreground"
                    )}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-xs truncate">{p.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        // Modo de Visualização normal
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-accent text-accent-foreground flex items-center justify-center shrink-0 border border-border/40">
              <UserIcon className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-foreground truncate">{user.name || user.email.split('@')[0]}</p>
                <Badge 
                  variant={user.role === 'admin' ? "default" : user.role === 'manager' ? "outline" : "secondary"}
                  className={
                    user.role === 'supervisor' 
                      ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-medium' 
                      : user.role === 'viewer'
                      ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400 font-medium'
                      : ''
                  }
                >
                  {user.role === 'admin' 
                    ? 'Administrador' 
                    : user.role === 'manager' 
                    ? 'Gestor' 
                    : user.role === 'supervisor' 
                    ? 'Supervisor' 
                    : user.role === 'viewer' 
                    ? 'Visualizador' 
                    : 'Operador'}
                </Badge>
                {user.role !== 'admin' && user.cell && (
                  <Badge variant="outline" className="bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-medium">
                    Célula: {user.cell}
                  </Badge>
                )}
                {isSelf && <Badge variant="outline" className="bg-secondary/40 border-primary/20 text-primary">Você</Badge>}
                {user.report_delivery_enabled && (
                  <Badge variant="outline" className="gap-1 bg-blue-500/5 border-blue-500/20 text-blue-600 dark:text-blue-400">
                    <MailCheck className="h-3 w-3" /> E-mails/IA
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground truncate">{user.email}</p>
              
              {/* Permissões Ativas em Badges */}
              <div className="flex gap-1.5 flex-wrap pt-1.5">
                {Object.entries(user.permissions || {}).map(([key, active]) => {
                  if (!active) return null;
                  return (
                    <Badge key={key} variant="outline" className="bg-card text-[10px] py-0 px-2 h-5 font-normal border-border/60">
                      {PERMISSION_LABELS[key] || key}
                    </Badge>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 self-end sm:self-center shrink-0">
            {/* Ações de Email/Senha */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={() => onResetPassword(user.email)}
                title="Enviar e-mail para redefinir a senha"
              >
                <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
                Redefinir Senha
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={() => onResendInvite(user.email)}
                title="Reenviar e-mail de convite / confirmação"
              >
                <Send className="w-3.5 h-3.5 text-muted-foreground" />
                Reenviar Convite
              </Button>
            </div>

            {/* Ações de Edição/Exclusão */}
            <div className="flex gap-1.5 border-l border-border/40 pl-2">
              <Button
                variant="outline"
                size="icon"
                className="w-8 h-8 rounded-lg"
                onClick={() => setIsEditing(true)}
                title="Editar colaborador"
              >
                <Edit3 className="w-4 h-4 text-muted-foreground hover:text-foreground" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="w-8 h-8 rounded-lg hover:bg-destructive/10 hover:border-destructive/30"
                onClick={() => onDelete(user.id)}
                disabled={isSelf}
                title={isSelf ? "Você não pode excluir a si mesmo" : "Excluir colaborador"}
              >
                <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive transition-colors" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
