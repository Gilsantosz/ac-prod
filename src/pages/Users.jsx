import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@/lib/localDb';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldAlert, Users as UsersIcon, HardHat, Shield, Clock, Mail, Trash2, Edit3, ShieldCheck } from 'lucide-react';
import InviteUserForm from '@/components/users/InviteUserForm';
import UserList from '@/components/users/UserList';
import ManagersManager from '@/components/managers/ManagersManager';
import ReportSchedulesManager from '@/components/users/ReportSchedulesManager';
import PageHeader from '@/components/ui/PageHeader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export default function Users() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [saving, setSaving] = useState(false);
  const [emailGroups, setEmailGroups] = useState([]);
  const [editingGroup, setEditingGroup] = useState(null);
  const [groupForm, setGroupForm] = useState({ name: '', emails: '' });

  // Carregar grupos de e-mail do localStorage
  useEffect(() => {
    const saved = localStorage.getItem('acprod_email_groups');
    if (saved) {
      try {
        setEmailGroups(JSON.parse(saved));
      } catch (e) {
        console.error('Erro ao ler grupos de e-mail:', e);
      }
    }
  }, []);

  const saveEmailGroups = (groups) => {
    setEmailGroups(groups);
    localStorage.setItem('acprod_email_groups', JSON.stringify(groups));
  };

  const { data: me, isLoading: loadingMe } = useQuery({
    queryKey: ['me'],
    queryFn: () => base44.auth.me(),
  });

  const canManageUsers = me?.role === 'admin';
  const canManageOperators = canManageUsers || me?.permissions?.manage_operators;
  const allowedTabs = canManageUsers
    ? ['users', 'managers', 'permissions', 'reports', 'email_groups']
    : canManageOperators
      ? ['users']
      : [];
  const defaultTab = 'users';
  const requestedTab = searchParams.get('tab');
  const activeTab = allowedTabs.includes(requestedTab) ? requestedTab : defaultTab;
  const handleTabChange = (value) => {
    setSearchParams(value === 'users' ? {} : { tab: value }, { replace: true });
  };

  const { data: users = [], isError } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list('-created_date', 200),
    initialData: [],
    enabled: canManageUsers || canManageOperators,
  });

  const invite = useMutation({
    mutationFn: ({ email, role, name, password, permissions, cell }) =>
      base44.users.inviteUser(email, role, name, password, permissions, cell),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Colaborador criado com sucesso!');
    },
    onError: (e) => toast.error(e?.message || 'Falha ao cadastrar usuário'),
  });

  const updateUser = useMutation({
    mutationFn: ({ id, payload }) => base44.entities.User.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      toast.success('Colaborador atualizado com sucesso!');
    },
    onError: (e) => toast.error(e?.message || 'Falha ao atualizar colaborador'),
  });

  const deleteUser = useMutation({
    mutationFn: async (id) => {
      return base44.users.deleteUser(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Colaborador excluído.');
    },
    onError: () => toast.error('Falha ao excluir colaborador'),
  });

  const handleInvite = async (email, role, name, password, permissions, cell) => {
    setSaving(true);
    try {
      await invite.mutateAsync({ email, role, name, password, permissions, cell });
    } catch (err) {
      console.error('Erro ao cadastrar usuário:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async (email) => {
    try {
      await base44.auth.resetPasswordRequest(email);
      toast.success(`E-mail de redefinição de senha enviado para ${email}`);
    } catch (e) {
      toast.error(e?.message || 'Erro ao solicitar redefinição de senha');
    }
  };

  const handleResendInvite = async (email) => {
    try {
      await base44.auth.resendOtp(email);
      toast.success(`E-mail de confirmação reenviado para ${email}`);
    } catch (e) {
      toast.error(e?.message || 'Erro ao reenviar convite');
    }
  };

  const handleAddEmailGroup = (e) => {
    e.preventDefault();
    if (!groupForm.name.trim() || !groupForm.emails.trim()) return;

    const emailList = groupForm.emails
      .split(',')
      .map((em) => em.trim())
      .filter((em) => em.includes('@'));

    if (emailList.length === 0) {
      toast.error('Insira e-mails válidos separados por vírgula.');
      return;
    }

    if (editingGroup) {
      const updated = emailGroups.map((g) =>
        g.id === editingGroup.id ? { ...g, name: groupForm.name.trim(), emails: emailList } : g
      );
      saveEmailGroups(updated);
      toast.success('Grupo de e-mail atualizado!');
      setEditingGroup(null);
    } else {
      const newGroup = {
        id: crypto.randomUUID(),
        name: groupForm.name.trim(),
        emails: emailList,
      };
      saveEmailGroups([...emailGroups, newGroup]);
      toast.success('Grupo de e-mail cadastrado!');
    }

    setGroupForm({ name: '', emails: '' });
  };

  const handleEditEmailGroup = (g) => {
    setEditingGroup(g);
    setGroupForm({ name: g.name, emails: g.emails.join(', ') });
  };

  const handleDeleteEmailGroup = (id) => {
    if (confirm('Deseja excluir este grupo de e-mail?')) {
      const filtered = emailGroups.filter((g) => g.id !== id);
      saveEmailGroups(filtered);
      toast.success('Grupo excluído.');
    }
  };

  if (loadingMe) {
    return (
      <div className="p-6 lg:p-8 max-w-3xl mx-auto">
        <div className="py-20 text-center text-muted-foreground">Carregando permissões...</div>
      </div>
    );
  }

  if (me && !canManageUsers && !canManageOperators) {
    return (
      <div className="p-6 lg:p-8 max-w-3xl mx-auto">
        <div className="flex flex-col items-center text-center gap-3 py-20 text-muted-foreground border border-dashed border-border rounded-2xl">
          <ShieldAlert className="w-10 h-10" />
          <p className="font-medium text-foreground">Acesso restrito</p>
          <p>Apenas administradores ou perfis autorizados podem gerenciar usuários e operadores.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-5 sm:space-y-6">
      <PageHeader
        title="Usuários e Acessos"
        subtitle="Gerencie colaboradores, configure permissões granulares, agende relatórios automáticos e controle distribuição de e-mails."
        icon={UsersIcon}
      />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="flex flex-wrap gap-1 bg-muted/60 p-1 rounded-xl w-fit">
          {(canManageUsers || canManageOperators) && <TabsTrigger value="users" className="gap-2 rounded-lg"><UsersIcon className="w-4 h-4" /> Usuários</TabsTrigger>}
          {canManageUsers && <TabsTrigger value="managers" className="gap-2 rounded-lg"><HardHat className="w-4 h-4" /> Gestores</TabsTrigger>}
          {canManageUsers && <TabsTrigger value="permissions" className="gap-2 rounded-lg"><Shield className="w-4 h-4" /> Permissões</TabsTrigger>}
          {canManageUsers && <TabsTrigger value="reports" className="gap-2 rounded-lg"><Clock className="w-4 h-4" /> Relatórios Automáticos</TabsTrigger>}
          {canManageUsers && <TabsTrigger value="email_groups" className="gap-2 rounded-lg"><Mail className="w-4 h-4" /> Grupos de E-mail</TabsTrigger>}
        </TabsList>

        <TabsContent value="users" className="space-y-6">
          <InviteUserForm onInvite={handleInvite} saving={saving} />
          
          {isError ? (
            <div className="text-center py-10 text-muted-foreground">Não foi possível carregar os usuários.</div>
          ) : (
            <UserList
              users={users}
              currentUserId={me?.id}
              onUpdate={(id, payload) => updateUser.mutate({ id, payload })}
              onDelete={(id) => {
                if (confirm('Tem certeza que deseja remover este colaborador do sistema?')) {
                  deleteUser.mutate(id);
                }
              }}
              onResetPassword={handleResetPassword}
              onResendInvite={handleResendInvite}
            />
          )}
        </TabsContent>

        <TabsContent value="managers">
          <ManagersManager />
        </TabsContent>

        <TabsContent value="permissions">
          <Card className="p-6 border-border/60 shadow-sm space-y-6">
            <div>
              <h3 className="font-semibold text-lg text-foreground">Matriz de Níveis de Acesso</h3>
              <p className="text-sm text-muted-foreground">Entenda quais recursos estão disponíveis por padrão para cada perfil de usuário.</p>
            </div>

            <div className="overflow-x-auto border border-border/60 rounded-xl">
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="bg-muted/40 text-muted-foreground font-semibold border-b border-border/60">
                    <th className="p-3.5">Recurso / Permissão</th>
                    <th className="p-3.5 text-center">Operador</th>
                    <th className="p-3.5 text-center">Gestor</th>
                    <th className="p-3.5 text-center">Administrador</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  <tr>
                    <td className="p-3.5 font-medium">Visualizar Painéis (OEE, Ocorrências, Metas)</td>
                    <td className="p-3.5 text-center text-emerald-600 dark:text-emerald-400 font-semibold">Sim</td>
                    <td className="p-3.5 text-center text-emerald-600 dark:text-emerald-400 font-semibold">Sim</td>
                    <td className="p-3.5 text-center text-emerald-600 dark:text-emerald-400 font-semibold">Sim</td>
                  </tr>
                  <tr className="bg-muted/10">
                    <td className="p-3.5 font-medium">Lançar Produção e Apontamentos</td>
                    <td className="p-3.5 text-center text-emerald-600 dark:text-emerald-400 font-semibold">Sim</td>
                    <td className="p-3.5 text-center text-emerald-600 dark:text-emerald-400 font-semibold">Sim</td>
                    <td className="p-3.5 text-center text-emerald-600 dark:text-emerald-400 font-semibold">Sim</td>
                  </tr>
                  <tr>
                    <td className="p-3.5 font-medium">Gerenciar e Tratar Ocorrências</td>
                    <td className="p-3.5 text-center text-emerald-600 dark:text-emerald-400 font-semibold">Sim</td>
                    <td className="p-3.5 text-center text-emerald-600 dark:text-emerald-400 font-semibold">Sim</td>
                    <td className="p-3.5 text-center text-emerald-600 dark:text-emerald-400 font-semibold">Sim</td>
                  </tr>
                  <tr className="bg-muted/10">
                    <td className="p-3.5 font-medium">Visualizar e Exportar Relatórios Industriais</td>
                    <td className="p-3.5 text-center text-muted-foreground/60">Não</td>
                    <td className="p-3.5 text-center text-emerald-600 dark:text-emerald-400 font-semibold">Sim</td>
                    <td className="p-3.5 text-center text-emerald-600 dark:text-emerald-400 font-semibold">Sim</td>
                  </tr>
                  <tr>
                    <td className="p-3.5 font-medium">Configurar Células de Trabalho e Metas</td>
                    <td className="p-3.5 text-center text-muted-foreground/60">Não</td>
                    <td className="p-3.5 text-center text-muted-foreground/60">Não</td>
                    <td className="p-3.5 text-center text-emerald-600 dark:text-emerald-400 font-semibold">Sim</td>
                  </tr>
                  <tr className="bg-muted/10">
                    <td className="p-3.5 font-medium">Gerenciar Usuários e Permissões</td>
                    <td className="p-3.5 text-center text-muted-foreground/60">Não</td>
                    <td className="p-3.5 text-center text-muted-foreground/60">Não</td>
                    <td className="p-3.5 text-center text-emerald-600 dark:text-emerald-400 font-semibold">Sim</td>
                  </tr>
                  <tr>
                    <td className="p-3.5 font-medium">Alterar Configurações Críticas do Sistema</td>
                    <td className="p-3.5 text-center text-muted-foreground/60">Não</td>
                    <td className="p-3.5 text-center text-muted-foreground/60">Não</td>
                    <td className="p-3.5 text-center text-emerald-600 dark:text-emerald-400 font-semibold">Sim</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex gap-3">
              <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
              <div className="text-sm">
                <p className="font-semibold text-foreground">Regras de Segurança RLS Ativas</p>
                <p className="text-muted-foreground mt-0.5">As restrições de permissões são validadas em nível de banco de dados. Gestores só podem gerenciar dados de produção das suas respectivas células de trabalho monitoradas.</p>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="reports">
          <ReportSchedulesManager />
        </TabsContent>

        <TabsContent value="email_groups" className="space-y-6">
          <Card className="p-6 border-border/60 shadow-sm space-y-4">
            <h3 className="font-semibold text-lg text-foreground">
              {editingGroup ? 'Editar Grupo de E-mail' : 'Cadastrar Novo Grupo de E-mail'}
            </h3>
            
            <form onSubmit={handleAddEmailGroup} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome do Grupo</Label>
                  <Input
                    value={groupForm.name}
                    onChange={(e) => setGroupForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Ex: Diretoria Industrial, Equipe de Qualidade"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>E-mails dos Participantes</Label>
                  <Input
                    value={groupForm.emails}
                    onChange={(e) => setGroupForm((f) => ({ ...f, emails: e.target.value }))}
                    placeholder="Ex: joao@leo.com, maria@leo.com"
                    required
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                {editingGroup && (
                  <Button type="button" variant="outline" onClick={() => { setEditingGroup(null); setGroupForm({ name: '', emails: '' }); }}>
                    Cancelar
                  </Button>
                )}
                <Button type="submit">
                  {editingGroup ? 'Atualizar Grupo' : 'Criar Grupo'}
                </Button>
              </div>
            </form>
          </Card>

          <div className="space-y-4">
            <h3 className="font-semibold text-lg text-foreground">Grupos de E-mail Ativos</h3>
            
            {emailGroups.length === 0 ? (
              <Card className="p-8 text-center text-muted-foreground border-dashed border-border/80">
                Nenhum grupo de e-mail cadastrado. Crie um grupo acima para facilitar o envio de relatórios automáticos.
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {emailGroups.map((g) => (
                  <Card key={g.id} className="p-4 border-border/60 flex flex-col justify-between gap-3 shadow-sm hover:border-border transition-colors">
                    <div>
                      <h4 className="font-semibold text-foreground text-base">{g.name}</h4>
                      <p className="text-xs text-muted-foreground mt-1">Participantes ({g.emails.length}):</p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {g.emails.map((email) => (
                          <Badge key={email} variant="secondary" className="text-[10px]">
                            {email}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 border-t border-border/40 pt-3 mt-1">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleEditEmailGroup(g)}>
                        <Edit3 className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => handleDeleteEmailGroup(g.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
