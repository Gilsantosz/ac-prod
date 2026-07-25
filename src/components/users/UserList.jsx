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
  Plug, GitFork, Box, Truck, BellRing, Layers, ShieldAlert, MailCheck, Check
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCells } from '@/hooks/useCells';
import { getDefaultPermissions } from '@/config/appRoutes';
import PageAccessMatrix, { normalizePagePermissions } from '@/components/users/PageAccessMatrix';


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



import ResetPasswordDialog from '@/components/users/ResetPasswordDialog';

export default function UserList({ users, currentUserId, onUpdate, onDelete, onResetPassword, onDirectResetPassword, onResendInvite, readOnly = false }) {
  const [resetUser, setResetUser] = useState(null);

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
            onOpenResetDialog={() => setResetUser(u)}
            onResetPassword={onResetPassword}
            onResendInvite={onResendInvite}
            readOnly={readOnly}
          />
        ))}
      </div>

      <ResetPasswordDialog
        user={resetUser}
        open={Boolean(resetUser)}
        onClose={() => setResetUser(null)}
        onDirectReset={onDirectResetPassword}
        onSendResetEmail={onResetPassword}
      />
    </div>
  );
}

function UserCard({ user, currentUserId, onUpdate, onDelete, onOpenResetDialog, onResetPassword, onResendInvite, readOnly }) {
  const { activeCells } = useCells();
  const [isEditing, setIsEditing] = useState(false);
  
  // States para edição
  const [editName, setEditName] = useState(user.name || '');
  const [editRole, setEditRole] = useState(user.role || 'operator');
  const [editManagedCells, setEditManagedCells] = useState(
    user.managed_cells?.length
      ? user.managed_cells
      : user.access_scope?.cells?.length
        ? user.access_scope.cells
        : user.cell
          ? [user.cell]
          : [],
  );
  const [editPermissions, setEditPermissions] = useState(() => user.permissions || getDefaultPermissions(user.role || 'operator'));
  const [editReportDelivery, setEditReportDelivery] = useState(Boolean(user.report_delivery_enabled));
  const [editDailyReport, setEditDailyReport] = useState(Boolean(user.receives_daily_report));
  const [editReportEmail, setEditReportEmail] = useState(user.report_email || user.email || '');


  const isSelf = user.id === currentUserId;

  const togglePermission = (key) => {
    setEditPermissions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSave = async () => {
    if (!editName.trim()) return;
    if (editRole === 'operator' && editManagedCells.length === 0) {
      alert('Selecione pelo menos uma célula autorizada para o operador.');
      return;
    }
    
    // 1. Atualizar Usuário
    await onUpdate(user.id, {
      name: editName.trim(),
      role: editRole,
      cell: editManagedCells[0] || '',
      managed_cells: editManagedCells,
      access_scope: {
        ...(user.access_scope || {}),
        cells: editManagedCells,
      },
      permissions: normalizePagePermissions(editPermissions, editRole),
      report_delivery_enabled: editReportDelivery,
      receives_daily_report: editReportDelivery && editDailyReport,
      report_email: editReportDelivery ? editReportEmail.trim().toLowerCase() : null,
    });

    setIsEditing(false);
  };

  const handleCancel = () => {
    // Resetar formulário
    setEditName(user.name || '');
    setEditRole(user.role || 'operator');
    setEditManagedCells(
      user.managed_cells?.length
        ? user.managed_cells
        : user.access_scope?.cells?.length
          ? user.access_scope.cells
          : user.cell
            ? [user.cell]
            : [],
    );
    setEditPermissions(user.permissions || getDefaultPermissions(user.role || 'operator'));
    setEditReportDelivery(Boolean(user.report_delivery_enabled));
    setEditDailyReport(Boolean(user.receives_daily_report));
    setEditReportEmail(user.report_email || user.email || '');

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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          </div>

          <div className="space-y-3 rounded-xl border border-border/60 p-4">
            <div>
              <Label>Células autorizadas</Label>
              <p className="text-xs text-muted-foreground">Selecione exatamente as células que este usuário poderá consultar e operar.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {activeCells.map((cell) => {
                const active = editManagedCells.includes(cell.name);
                return (
                  <button
                    type="button"
                    key={cell.id}
                    onClick={() => setEditManagedCells((current) => (
                      active ? current.filter((name) => name !== cell.name) : [...current, cell.name]
                    ))}
                    className={cn(
                      'flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors',
                      active ? 'border-primary bg-primary/5 font-semibold' : 'border-border/60 text-muted-foreground hover:bg-muted/40',
                    )}
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
            {editReportDelivery && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor={`report-email-${user.id}`}>E-mail que recebe os relatórios</Label>
                <Input
                  id={`report-email-${user.id}`}
                  type="email"
                  value={editReportEmail}
                  onChange={(event) => setEditReportEmail(event.target.value)}
                  placeholder={user.email}
                  required
                />
                <p className="text-xs text-muted-foreground">Pode ser diferente do e-mail usado para entrar no sistema. A IA respeitará exatamente este endereço.</p>
              </div>
            )}
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



          <PageAccessMatrix
            role={editRole}
            permissions={editPermissions}
            onChange={setEditPermissions}
            disabled={editRole === 'admin'}
          />
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
                {user.role !== 'admin' && (
                  (user.managed_cells?.length ? user.managed_cells : user.cell ? [user.cell] : []).map((cell) => (
                    <Badge key={cell} variant="outline" className="bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-medium">
                      Célula: {cell}
                    </Badge>
                  ))
                )}
                {isSelf && <Badge variant="outline" className="bg-secondary/40 border-primary/20 text-primary">Você</Badge>}
                {user.report_delivery_enabled && (
                  <Badge variant="outline" className="gap-1 bg-blue-500/5 border-blue-500/20 text-blue-600 dark:text-blue-400">
                    <MailCheck className="h-3 w-3" /> E-mails/IA
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground truncate">{user.email}</p>
              {user.report_delivery_enabled && user.report_email && user.report_email !== user.email && (
                <p className="text-xs text-blue-600 dark:text-blue-400 truncate">Relatórios: {user.report_email}</p>
              )}
              
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

          {!readOnly && <div className="flex items-center justify-end gap-3 self-end sm:self-center shrink-0">
            {/* Ações de Email/Senha */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={onOpenResetDialog}
                title="Redefinir a senha deste colaborador diretamente na página"
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
          </div>}
        </div>
      )}
    </Card>
  );
}
