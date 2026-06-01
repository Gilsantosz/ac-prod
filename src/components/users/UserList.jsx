import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { User as UserIcon, Eye, EyeOff, Edit3, Trash2, Save, X, LayoutDashboard, PlusCircle, AlertOctagon, Boxes, HardHat, LineChart, Zap, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCells } from '@/hooks/useCells';

const PERMISSION_LABELS = {
  view_dashboards: 'Painéis',
  register_production: 'Apontamentos',
  manage_occurrences: 'Ocorrências',
  manage_cells: 'Células/Metas',
  manage_operators: 'Operadores',
  view_reports: 'Relatórios',
  manage_automations: 'Automações',
  manage_users: 'Usuários',
};

const PERMISSION_METADATA = [
  { key: 'view_dashboards', label: 'Painéis', icon: LayoutDashboard },
  { key: 'register_production', label: 'Apontamentos', icon: PlusCircle },
  { key: 'manage_occurrences', label: 'Ocorrências', icon: AlertOctagon },
  { key: 'manage_cells', label: 'Células/Metas', icon: Boxes },
  { key: 'manage_operators', label: 'Operadores', icon: HardHat },
  { key: 'view_reports', label: 'Relatórios', icon: LineChart },
  { key: 'manage_automations', label: 'Automações', icon: Zap },
  { key: 'manage_users', label: 'Usuários', icon: Users, warning: true },
];

export default function UserList({ users, currentUserId, onUpdate, onDelete }) {
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
          />
        ))}
      </div>
    </div>
  );
}

function UserCard({ user, currentUserId, onUpdate, onDelete }) {
  const { activeCells } = useCells();
  const [isEditing, setIsEditing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  // States para edição
  const [editName, setEditName] = useState(user.name || '');
  const [editPassword, setEditPassword] = useState(user.password || '');
  const [editRole, setEditRole] = useState(user.role || 'operator');
  const [editCell, setEditCell] = useState(user.cell || 'none');
  const [editPermissions, setEditPermissions] = useState(user.permissions || {
    view_dashboards: true,
    register_production: true,
    manage_occurrences: true,
    manage_cells: false,
    manage_operators: false,
    view_reports: false,
    manage_automations: false,
    manage_users: false,
  });

  const isSelf = user.id === currentUserId;

  const togglePermission = (key) => {
    setEditPermissions((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSave = async () => {
    if (!editName.trim() || !editPassword.trim()) return;
    await onUpdate(user.id, {
      name: editName.trim(),
      password: editPassword.trim(),
      role: editRole,
      cell: editCell === 'none' ? '' : editCell, // Enviando a célula vinculada no payload
      permissions: editPermissions,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    // Resetar formulário
    setEditName(user.name || '');
    setEditPassword(user.password || '');
    setEditRole(user.role || 'operator');
    setEditCell(user.cell || 'none');
    setEditPermissions(user.permissions || {
      view_dashboards: true,
      register_production: true,
      manage_occurrences: true,
      manage_cells: false,
      manage_operators: false,
      view_reports: false,
      manage_automations: false,
      manage_users: false,
    });
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

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Nome Completo</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Senha de Acesso</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  required
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
              <Label>Papel</Label>
              <Select value={editRole} onValueChange={setEditRole} disabled={isSelf}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="operator">Operador / Usuário</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
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
                <Badge variant={user.role === 'admin' ? "default" : "secondary"}>
                  {user.role === 'admin' ? 'Administrador' : 'Operador'}
                </Badge>
                {user.role !== 'admin' && user.cell && (
                  <Badge variant="outline" className="bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-medium">
                    Célula: {user.cell}
                  </Badge>
                )}
                {isSelf && <Badge variant="outline" className="bg-secondary/40 border-primary/20 text-primary">Você</Badge>}
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
            {/* Visualização de Senha */}
            <div className="flex items-center gap-1.5 bg-secondary/30 px-3 py-1.5 rounded-lg border border-border/30 text-xs text-muted-foreground">
              <span className="font-mono">{showPassword ? user.password : '••••••••'}</span>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-muted-foreground hover:text-foreground transition-colors ml-1"
                title={showPassword ? "Ocultar senha" : "Ver senha"}
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Ações */}
            <div className="flex gap-1.5">
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