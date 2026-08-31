import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Edit3,
  KeyRound,
  Mail,
  Plus,
  Save,
  Search,
  Send,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCells } from '@/hooks/useCells';
import {
  SYSTEM_ROLE_OPTIONS,
  canManageSystemRole,
  getRoleDefaultPermissions,
  getSystemRoleLabel,
  normalizeSystemRole,
} from '@/lib/roleProfiles';
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
  view_audit_logs: 'Logs de Auditoria',
  view_replacements: 'Visualizar Reposições',
  manage_replacements: 'Gerenciar Reposições',
  approve_replacements: 'Aprovar Reposições',
  force_complete_replacements: 'Concluir Reposição Forçadamente',
  view_quality: 'Visualizar Qualidade',
  manage_quality: 'Gerenciar Qualidade',
  close_quality_nonconformities: 'Encerrar Não Conformidades',
};

export default function UserList({
  users,
  currentUserId,
  currentUser,
  onUpdate,
  onDelete,
  onResetPassword,
  onDirectResetPassword,
  onResendInvite,
  onOpenCreateModal,
  readOnly = false,
}) {
  const [resetUser, setResetUser] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredUsers = users.filter((user) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      user.email?.toLowerCase().includes(query)
      || user.name?.toLowerCase().includes(query)
      || user.role?.toLowerCase().includes(query)
      || getSystemRoleLabel(user.role).toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Users className="h-5 w-5 text-primary" /> Colaboradores cadastrados ({users.length})
          </h3>
          <p className="text-xs text-muted-foreground">Contas, papéis, células autorizadas e permissões do sistema.</p>
        </div>

        <div className="flex w-full items-center gap-3 sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Buscar por e-mail, nome ou papel..." className="h-9 pl-9 text-xs" />
          </div>
          {!readOnly && onOpenCreateModal && (
            <Button onClick={onOpenCreateModal} className="h-9 shrink-0 gap-1.5 bg-primary text-xs font-bold text-primary-foreground shadow-sm">
              <Plus className="h-4 w-4" /> Novo usuário
            </Button>
          )}
        </div>
      </div>

      {!filteredUsers.length ? (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center text-muted-foreground">Nenhum usuário encontrado com os filtros aplicados.</div>
      ) : (
        <div className="space-y-3">
          {filteredUsers.map((user) => (
            <UserCard
              key={user.id}
              user={user}
              currentUserId={currentUserId}
              currentUser={currentUser}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onOpenResetDialog={() => setResetUser(user)}
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

function canManageTarget(currentUser, targetUser) {
  return canManageSystemRole(currentUser, targetUser?.role);
}

function UserCard({
  user,
  currentUserId,
  currentUser,
  onUpdate,
  onDelete,
  onOpenResetDialog,
  onResendInvite,
  readOnly,
}) {
  const { activeCells } = useCells();
  const [isEditing, setIsEditing] = useState(false);
  const [showPermissionsDetails, setShowPermissionsDetails] = useState(false);
  const [editName, setEditName] = useState(user.name || '');
  const [editRole, setEditRole] = useState(normalizeSystemRole(user.role));
  const [editManagedCells, setEditManagedCells] = useState(
    user.managed_cells?.length
      ? user.managed_cells
      : user.access_scope?.cells?.length
        ? user.access_scope.cells
        : user.cell ? [user.cell] : [],
  );
  const [editPermissions, setEditPermissions] = useState(() => user.permissions || getRoleDefaultPermissions(user.role));
  const [editReportDelivery, setEditReportDelivery] = useState(Boolean(user.report_delivery_enabled));
  const [editDailyReport, setEditDailyReport] = useState(Boolean(user.receives_daily_report));
  const [editReportEmail, setEditReportEmail] = useState(user.report_email || user.email || '');

  const isSelf = user.id === currentUserId;
  const canResetTarget = !readOnly && canManageTarget(currentUser, user);
  const canEditProfiles = !readOnly && normalizeSystemRole(currentUser?.role) === 'admin';
  const activePermissionsCount = Object.values(user.permissions || {}).filter(Boolean).length;

  const resetEditingState = () => {
    setEditName(user.name || '');
    setEditRole(normalizeSystemRole(user.role));
    setEditManagedCells(
      user.managed_cells?.length
        ? user.managed_cells
        : user.access_scope?.cells?.length
          ? user.access_scope.cells
          : user.cell ? [user.cell] : [],
    );
    setEditPermissions(user.permissions || getRoleDefaultPermissions(user.role));
    setEditReportDelivery(Boolean(user.report_delivery_enabled));
    setEditDailyReport(Boolean(user.receives_daily_report));
    setEditReportEmail(user.report_email || user.email || '');
  };

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
    resetEditingState();
    setIsEditing(false);
  };

  const role = normalizeSystemRole(user.role);
  const roleClass = role === 'quality_manager'
    ? 'border-fuchsia-500/25 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300'
    : role === 'supervisor'
      ? 'border-indigo-500/20 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
      : role === 'viewer'
        ? 'border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400'
        : '';

  return (
    <Card className={cn('border shadow-sm transition-all duration-200', isEditing ? 'border-primary bg-card p-6' : 'border-border/60 p-4 hover:border-border')}>
      {isEditing ? (
        <div className="space-y-5">
          <div className="flex items-center justify-between border-b border-border/40 pb-3">
            <h4 className="flex items-center gap-2 font-semibold text-foreground"><Edit3 className="h-4 w-4 text-primary" /> Editar colaborador</h4>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleCancel} className="gap-1.5 text-xs"><X className="h-3.5 w-3.5" /> Cancelar</Button>
              <Button size="sm" onClick={handleSave} className="gap-1.5 px-4 text-xs font-bold"><Save className="h-3.5 w-3.5" /> Salvar alterações</Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Nome completo</Label>
              <Input value={editName} onChange={(event) => setEditName(event.target.value)} required className="h-9 text-xs" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Papel no sistema</Label>
              <Select value={editRole} onValueChange={(value) => { setEditRole(value); setEditPermissions(getRoleDefaultPermissions(value)); }} disabled={isSelf}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SYSTEM_ROLE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-border/60 bg-secondary/10 p-4">
            <div>
              <Label className="text-xs font-bold">Células autorizadas</Label>
              <p className="text-[11px] text-muted-foreground">O escopo selecionado também restringe decisões de Qualidade e Reposição.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {activeCells.map((cell) => {
                const active = editManagedCells.includes(cell.name);
                return (
                  <button
                    type="button"
                    key={cell.id}
                    onClick={() => setEditManagedCells((current) => active ? current.filter((name) => name !== cell.name) : [...current, cell.name])}
                    className={cn('flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition-colors', active ? 'border-primary bg-primary/10 font-semibold' : 'border-border/60 text-muted-foreground hover:bg-muted/40')}
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

          <PageAccessMatrix role={editRole} permissions={editPermissions} onChange={setEditPermissions} disabled={editRole === 'admin'} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex min-w-0 items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary"><Mail className="h-5 w-5" /></div>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-sm font-bold tracking-tight text-foreground">{user.email}</p>
                  <Badge variant={role === 'admin' ? 'default' : 'outline'} className={`text-[10px] font-semibold ${roleClass}`}>{getSystemRoleLabel(role, { short: true })}</Badge>
                  {isSelf && <Badge variant="outline" className="border-primary/20 bg-secondary/40 text-[10px] text-primary">Você</Badge>}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{user.name || user.email.split('@')[0]}</span>
                  {role !== 'admin' && (user.managed_cells?.length ? user.managed_cells : user.cell ? [user.cell] : []).map((cell) => (
                    <Badge key={cell} variant="outline" className="border-emerald-500/20 bg-emerald-500/5 text-[10px] text-emerald-600 dark:text-emerald-400">{cell}</Badge>
                  ))}
                  <button type="button" onClick={() => setShowPermissionsDetails((current) => !current)} className="ml-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                    {activePermissionsCount} permissões {showPermissionsDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                </div>
              </div>
            </div>

            {(canResetTarget || canEditProfiles) && (
              <div className="flex shrink-0 items-center justify-end gap-2 self-end sm:self-center">
                {canResetTarget && (
                  <>
                    <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={onOpenResetDialog} title="Redefinir a senha deste colaborador"><KeyRound className="h-3.5 w-3.5 text-muted-foreground" /> Redefinir senha</Button>
                    <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => onResendInvite(user.email)} title="Reenviar acesso"><Send className="h-3.5 w-3.5 text-muted-foreground" /> Reenviar</Button>
                  </>
                )}
                {canEditProfiles && (
                  <div className="flex gap-1 border-l border-border/40 pl-2">
                    <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg" onClick={() => setIsEditing(true)} title="Editar colaborador"><Edit3 className="h-4 w-4 text-muted-foreground" /></Button>
                    <Button variant="outline" size="icon" className="h-8 w-8 rounded-lg hover:border-destructive/30 hover:bg-destructive/10" onClick={() => onDelete(user.id)} disabled={isSelf} title={isSelf ? 'Você não pode excluir a si mesmo' : 'Excluir colaborador'}><Trash2 className="h-4 w-4 text-muted-foreground transition-colors hover:text-destructive" /></Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {showPermissionsDetails && (
            <div className="flex flex-wrap gap-1.5 border-t border-border/30 pt-2 animate-in fade-in-50 duration-150">
              {Object.entries(user.permissions || {}).map(([key, active]) => active ? (
                <Badge key={key} variant="outline" className="border-border/60 bg-card px-2 py-0.5 text-[10px] font-normal">{PERMISSION_LABELS[key] || key}</Badge>
              ) : null)}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
