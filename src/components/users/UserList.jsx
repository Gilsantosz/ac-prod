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
  Plug, GitFork, Box, Truck, BellRing, Layers, ShieldAlert, MailCheck, Check, Search, Plus, ChevronDown, ChevronUp, Mail
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCells } from '@/hooks/useCells';
import { getDefaultPermissions } from '@/config/appRoutes';
import PageAccessMatrix, { normalizePagePermissions } from '@/components/users/PageAccessMatrix';
import ResetPasswordDialog from '@/components/users/ResetPasswordDialog';

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
  send_reports: 'Enviar Relatórios',
  schedule_reports: 'Agendar Relatórios',
  manage_report_recipients: 'Gerenciar Destinatários',
  view_report_delivery_logs: 'Histórico de Envios',
  manage_email_settings: 'Configurar E-mail',
  view_audit_logs: 'Logs de Auditoria'
};

export default function UserList({
  users,
  currentUserId,
  onUpdate,
  onDelete,
  onResetPassword,
  onDirectResetPassword,
  onResendInvite,
  onOpenCreateModal,
  readOnly = false
}) {
  const [resetUser, setResetUser] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredUsers = users.filter(u => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.role && u.role.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-semibold text-lg text-foreground flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" /> Colaboradores Cadastrados ({users.length})
          </h3>
          <p className="text-xs text-muted-foreground">
            Lista de contas registradas no sistema e suas permissões de acesso.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por e-mail ou nome..."
              className="pl-9 h-9 text-xs"
            />
          </div>
          {!readOnly && onOpenCreateModal && (
            <Button onClick={onOpenCreateModal} className="h-9 text-xs font-bold gap-1.5 shrink-0 bg-primary text-primary-foreground shadow-sm">
              <Plus className="w-4 h-4" /> Novo Usuário
            </Button>
          )}
        </div>
      </div>

      {!filteredUsers.length ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl">
          Nenhum usuário encontrado com os filtros aplicados.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredUsers.map((u) => (
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
      )}

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
  const [showPermissionsDetails, setShowPermissionsDetails] = useState(false);
  
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
  const activePermissionsCount = Object.values(user.permissions || {}).filter(Boolean).length;

  const handleSave = async () => {
    if (!editName.trim()) return;
    if (editRole === 'operator' && editManagedCells.length === 0) {
      alert('Selecione pelo menos uma célula autorizada para o operador.');
      return;
    }
    
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
        <div className="space-y-5">
          <div className="flex items-center justify-between border-b border-border/40 pb-3">
            <h4 className="font-semibold text-foreground flex items-center gap-2">
              <Edit3 className="w-4 h-4 text-primary" />
              Editar Colaborador
            </h4>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleCancel} className="gap-1.5 text-xs">
                <X className="w-3.5 h-3.5" /> Cancelar
              </Button>
              <Button size="sm" onClick={handleSave} className="gap-1.5 px-4 text-xs font-bold">
                <Save className="w-3.5 h-3.5" /> Salvar Alterações
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Nome Completo</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} required className="h-9 text-xs" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Papel no Sistema</Label>
              <Select value={editRole} onValueChange={setEditRole} disabled={isSelf}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
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

          <div className="space-y-3 rounded-xl border border-border/60 p-4 bg-secondary/10">
            <div>
              <Label className="text-xs font-bold">Células autorizadas</Label>
              <p className="text-[11px] text-muted-foreground">Selecione as células autorizadas para operação.</p>
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
                      'flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition-colors',
                      active ? 'border-primary bg-primary/10 font-semibold' : 'border-border/60 text-muted-foreground hover:bg-muted/40',
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

          <PageAccessMatrix
            role={editRole}
            permissions={editPermissions}
            onChange={setEditPermissions}
            disabled={editRole === 'admin'}
          />
        </div>
      ) : (
        /* Visualização Limpa e Organizada da Conta */
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 border border-primary/20">
                <Mail className="w-5 h-5" />
              </div>
              <div className="min-w-0 space-y-1">
                {/* E-mail Registrado em destaque principal */}
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-mono font-bold text-foreground text-sm tracking-tight">{user.email}</p>
                  <Badge 
                    variant={user.role === 'admin' ? "default" : user.role === 'manager' ? "outline" : "secondary"}
                    className={
                      user.role === 'supervisor' 
                        ? 'bg-indigo-500/10 border-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-semibold text-[10px]' 
                        : user.role === 'viewer'
                        ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400 font-semibold text-[10px]'
                        : 'text-[10px] font-semibold'
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
                  {isSelf && <Badge variant="outline" className="bg-secondary/40 border-primary/20 text-primary text-[10px]">Você</Badge>}
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                  <span className="font-medium text-foreground">{user.name || user.email.split('@')[0]}</span>
                  {user.role !== 'admin' && (
                    (user.managed_cells?.length ? user.managed_cells : user.cell ? [user.cell] : []).map((cell) => (
                      <Badge key={cell} variant="outline" className="bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px]">
                        {cell}
                      </Badge>
                    ))
                  )}
                  <button
                    type="button"
                    onClick={() => setShowPermissionsDetails(!showPermissionsDetails)}
                    className="text-[11px] font-medium text-primary hover:underline inline-flex items-center gap-1 ml-1"
                  >
                    {activePermissionsCount} permissões
                    {showPermissionsDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            </div>

            {!readOnly && (
              <div className="flex items-center justify-end gap-2 self-end sm:self-center shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  onClick={onOpenResetDialog}
                  title="Redefinir a senha deste colaborador"
                >
                  <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
                  Redefinir Senha
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  onClick={() => onResendInvite(user.email)}
                  title="Reenviar convite de acesso"
                >
                  <Send className="w-3.5 h-3.5 text-muted-foreground" />
                  Reenviar
                </Button>

                <div className="flex gap-1 border-l border-border/40 pl-2">
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
            )}
          </div>

          {/* Permissões Expansíveis caso o usuário queira detalhar */}
          {showPermissionsDetails && (
            <div className="pt-2 border-t border-border/30 flex gap-1.5 flex-wrap animate-in fade-in-50 duration-150">
              {Object.entries(user.permissions || {}).map(([key, active]) => {
                if (!active) return null;
                return (
                  <Badge key={key} variant="outline" className="bg-card text-[10px] py-0.5 px-2 font-normal border-border/60">
                    {PERMISSION_LABELS[key] || key}
                  </Badge>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
