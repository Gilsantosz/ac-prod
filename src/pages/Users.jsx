import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@/lib/localDb';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ShieldAlert, Users as UsersIcon, Shield, Clock, Mail, Trash2, Edit3, ShieldCheck,
  Activity, CheckCircle2, RefreshCw, Send, UserCheck, Plus, Check, X
} from 'lucide-react';
import InviteUserForm from '@/components/users/InviteUserForm';
import UserList from '@/components/users/UserList';
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

  // States para a aba Escopos
  const [selectedUserForScope, setSelectedUserForScope] = useState(null);
  const [selectedCells, setSelectedCells] = useState([]);
  const [selectedMachines, setSelectedMachines] = useState([]);

  // States para a aba Grupos
  const [editingGroup, setEditingGroup] = useState(null);
  const [groupForm, setGroupForm] = useState({ name: '', description: '' });
  const [groupMembers, setGroupMembers] = useState([]); // Array de { id, profile_id, external_email, name, email }
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberProfileId, setNewMemberProfileId] = useState('none');

  // States para Diagnósticos
  const [diagnosticEmail, setDiagnosticEmail] = useState('');
  const [sendingDiagnostic, setSendingDiagnostic] = useState(false);

  // Carregar dados de autenticação do usuário atual
  const { data: me, isLoading: loadingMe } = useQuery({
    queryKey: ['me'],
    queryFn: () => base44.auth.me(),
  });

  const canManageUsers = me?.role === 'admin';
  const canManageOperators = canManageUsers || me?.permissions?.manage_users || me?.permissions?.manage_operators;

  const allowedTabs = canManageUsers
    ? ['accounts', 'scopes', 'schedules', 'groups', 'history', 'diagnostics']
    : canManageOperators
      ? ['accounts', 'scopes']
      : [];

  const defaultTab = 'accounts';
  const requestedTab = searchParams.get('tab');
  const activeTab = allowedTabs.includes(requestedTab) ? requestedTab : defaultTab;

  const handleTabChange = (value) => {
    setSearchParams(value === 'accounts' ? {} : { tab: value }, { replace: true });
  };

  // Queries
  const { data: users = [], isLoading: isLoadingUsers } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list('-created_date', 500),
    initialData: [],
    enabled: canManageUsers || canManageOperators,
  });

  const { data: cells = [] } = useQuery({
    queryKey: ['cells'],
    queryFn: () => base44.entities.Cell.list('name'),
    initialData: [],
  });

  const { data: groups = [], refetch: refetchGroups } = useQuery({
    queryKey: ['emailRecipientGroups'],
    queryFn: () => base44.entities.EmailRecipientGroup.list('-created_at'),
    initialData: [],
    enabled: canManageUsers,
  });

  const { data: deliveryHistory = [], isLoading: isLoadingHistory, refetch: refetchHistory } = useQuery({
    queryKey: ['reportDeliveryHistory'],
    queryFn: () => base44.entities.ReportDeliveryHistory.list('-created_at', 50),
    initialData: [],
    enabled: canManageUsers,
  });

  // Mutations
  const invite = useMutation({
    mutationFn: ({ email, role, name, password, permissions, cell }) =>
      base44.users.inviteUser(email, role, name, password, permissions, cell),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Colaborador cadastrado com sucesso!');
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
    mutationFn: async (id) => base44.users.deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Colaborador excluído.');
    },
    onError: () => toast.error('Falha ao excluir colaborador'),
  });

  // Salvar grupo
  const saveGroupMutation = useMutation({
    mutationFn: async ({ id, name, description, members }) => {
      // 1. Salvar ou atualizar grupo
      let group;
      if (id) {
        group = await base44.entities.EmailRecipientGroup.update(id, { name, description });
      } else {
        group = await base44.entities.EmailRecipientGroup.create({ name, description });
      }

      const groupId = id || group.id;

      // 2. Resolver membros novos e excluir antigos
      // Nota: Para simplificar, apagamos membros atuais do grupo no banco e inserimos novamente
      const { data: existingMembers } = await base44.supabase
        .from('email_recipient_group_members')
        .select('id')
        .eq('group_id', groupId);

      if (existingMembers && existingMembers.length > 0) {
        await base44.supabase
          .from('email_recipient_group_members')
          .delete()
          .in('id', existingMembers.map(m => m.id));
      }

      for (const m of members) {
        await base44.supabase
          .from('email_recipient_group_members')
          .insert({
            group_id: groupId,
            profile_id: m.profile_id || null,
            external_email: m.external_email || null,
            recipient_name_snapshot: m.recipient_name_snapshot || m.name,
            recipient_email_snapshot: m.recipient_email_snapshot || m.email
          });
      }

      return group;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailRecipientGroups'] });
      toast.success(editingGroup ? 'Grupo atualizado!' : 'Grupo de e-mail criado!');
      setEditingGroup(null);
      setGroupForm({ name: '', description: '' });
      setGroupMembers([]);
    },
    onError: (e) => toast.error('Erro ao salvar grupo: ' + e.message)
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (id) => base44.entities.EmailRecipientGroup.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailRecipientGroups'] });
      toast.success('Grupo excluído.');
    },
    onError: () => toast.error('Erro ao excluir grupo')
  });

  // Operações de Escopo
  useEffect(() => {
    if (selectedUserForScope) {
      const scope = selectedUserForScope.access_scope || {};
      setSelectedCells(scope.cells || []);
      setSelectedMachines(scope.machines || []);
    } else {
      setSelectedCells([]);
      setSelectedMachines([]);
    }
  }, [selectedUserForScope]);

  const handleSaveScope = async () => {
    if (!selectedUserForScope) return;
    try {
      await updateUser.mutateAsync({
        id: selectedUserForScope.id,
        payload: {
          access_scope: {
            cells: selectedCells,
            machines: selectedMachines
          }
        }
      });
      setSelectedUserForScope(null);
    } catch (e) {
      console.error(e);
    }
  };

  const toggleCellSelection = (cellName) => {
    setSelectedCells(prev =>
      prev.includes(cellName) ? prev.filter(c => c !== cellName) : [...prev, cellName]
    );
  };

  // Operações de Grupo
  const handleAddMemberToForm = () => {
    if (newMemberProfileId !== 'none') {
      const u = users.find(usr => usr.id === newMemberProfileId);
      if (u) {
        if (groupMembers.some(m => m.profile_id === u.id)) {
          toast.error('Este colaborador já está no grupo.');
          return;
        }
        setGroupMembers(prev => [...prev, {
          profile_id: u.id,
          name: u.name,
          email: u.email
        }]);
      }
      setNewMemberProfileId('none');
    } else if (newMemberEmail.trim()) {
      const email = newMemberEmail.trim().toLowerCase();
      if (!email.includes('@')) {
        toast.error('Insira um e-mail válido.');
        return;
      }
      if (groupMembers.some(m => m.external_email === email)) {
        toast.error('Este e-mail já está no grupo.');
        return;
      }
      setGroupMembers(prev => [...prev, {
        external_email: email,
        name: email.split('@')[0],
        email: email
      }]);
      setNewMemberEmail('');
    }
  };

  const handleRemoveMemberFromForm = (index) => {
    setGroupMembers(prev => prev.filter((_, i) => i !== index));
  };

  const handleEditGroupClick = async (group) => {
    setEditingGroup(group);
    setGroupForm({ name: group.name, description: group.description || '' });

    // Buscar membros do banco
    const { data: members, error } = await base44.supabase
      .from('email_recipient_group_members')
      .select('*')
      .eq('group_id', group.id);

    if (!error && members) {
      setGroupMembers(members.map(m => ({
        id: m.id,
        profile_id: m.profile_id,
        external_email: m.external_email,
        name: m.recipient_name_snapshot || (m.profile_id ? 'Carregando...' : m.external_email),
        email: m.recipient_email_snapshot || m.external_email
      })));
    }
  };

  // Disparar envio de diagnóstico
  const handleSendDiagnosticReport = async () => {
    if (!diagnosticEmail.trim() || !diagnosticEmail.includes('@')) {
      toast.error('Por favor, informe um endereço de e-mail válido.');
      return;
    }
    setSendingDiagnostic(true);
    try {
      const { data, error } = await base44.functions.invoke('send-report-email', {
        body: {
          recipientEmail: diagnosticEmail.trim(),
          reportType: 'executive_summary',
          triggerSource: 'test'
        }
      });
      if (error) throw error;
      toast.success('E-mail de teste de diagnóstico enviado com sucesso!');
      refetchHistory();
    } catch (e) {
      toast.error('Erro ao enviar e-mail de teste: ' + e.message);
    } finally {
      setSendingDiagnostic(false);
    }
  };

  if (loadingMe) {
    return (
      <div className="p-6 lg:p-8 max-w-3xl mx-auto flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Carregando perfil...</span>
      </div>
    );
  }

  if (me && !canManageUsers && !canManageOperators) {
    return (
      <div className="p-6 lg:p-8 max-w-3xl mx-auto">
        <div className="flex flex-col items-center text-center gap-3 py-20 text-muted-foreground border border-dashed border-border rounded-2xl">
          <ShieldAlert className="w-10 h-10 text-destructive" />
          <p className="font-semibold text-foreground">Acesso restrito</p>
          <p>Você não tem privilégios administrativos para gerenciar usuários, escopos ou relatórios.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Controle Operacional & Acessos"
        subtitle="Gerenciamento de contas, vinculação de escopos industriais, configuração de automação de relatórios, grupos de e-mail e diagnósticos de infraestrutura."
        icon={UsersIcon}
      />

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="flex flex-wrap gap-1 bg-muted/60 p-1 rounded-xl w-fit">
          <TabsTrigger value="accounts" className="gap-2 rounded-lg">
            <UsersIcon className="w-4 h-4" /> Contas
          </TabsTrigger>
          <TabsTrigger value="scopes" className="gap-2 rounded-lg">
            <UserCheck className="w-4 h-4" /> Escopos Células
          </TabsTrigger>
          {canManageUsers && (
            <>
              <TabsTrigger value="schedules" className="gap-2 rounded-lg">
                <Clock className="w-4 h-4" /> Agendamentos
              </TabsTrigger>
              <TabsTrigger value="groups" className="gap-2 rounded-lg">
                <Mail className="w-4 h-4" /> Grupos
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-2 rounded-lg">
                <Clock className="w-4 h-4" /> Histórico
              </TabsTrigger>
              <TabsTrigger value="diagnostics" className="gap-2 rounded-lg">
                <Activity className="w-4 h-4" /> Diagnósticos
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {/* ─── 1. ABA CONTAS ──────────────────────────────────────── */}
        <TabsContent value="accounts" className="space-y-6">
          <InviteUserForm onInvite={handleInvite} saving={saving} />
          <UserList
            users={users}
            currentUserId={me?.id}
            onUpdate={(id, payload) => updateUser.mutate({ id, payload })}
            onDelete={(id) => {
              if (confirm('Tem certeza que deseja remover este colaborador?')) {
                deleteUser.mutate(id);
              }
            }}
            onResetPassword={handleResetPassword}
            onResendInvite={handleResendInvite}
          />
        </TabsContent>

        {/* ─── 2. ABA ESCOPOS ─────────────────────────────────────── */}
        <TabsContent value="scopes" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="p-5 md:col-span-1 border-border/60 shadow-sm space-y-4">
              <div>
                <h3 className="font-semibold text-lg text-foreground">Selecionar Usuário</h3>
                <p className="text-xs text-muted-foreground">Escolha um colaborador para vincular ou modificar seu escopo operacional de monitoramento.</p>
              </div>
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                {users
                  .filter(u => u.role !== 'admin')
                  .map(u => (
                    <button
                      key={u.id}
                      onClick={() => setSelectedUserForScope(u)}
                      className={`w-full text-left p-3 rounded-xl border transition-all text-sm flex items-center justify-between ${
                        selectedUserForScope?.id === u.id
                          ? 'border-primary bg-primary/5 font-semibold text-foreground'
                          : 'border-border/60 hover:bg-muted/40 text-muted-foreground'
                      }`}
                    >
                      <div>
                        <p className="font-medium text-foreground">{u.name || u.email.split('@')[0]}</p>
                        <p className="text-[10px] text-muted-foreground capitalize">{u.role}</p>
                      </div>
                      {u.access_scope?.cells?.length > 0 && (
                        <Badge variant="secondary" className="text-[10px]">
                          {u.access_scope.cells.length} cél.
                        </Badge>
                      )}
                    </button>
                  ))}
              </div>
            </Card>

            <Card className="p-5 md:col-span-2 border-border/60 shadow-sm space-y-5">
              {selectedUserForScope ? (
                <>
                  <div className="flex justify-between items-center border-b border-border/40 pb-3">
                    <div>
                      <h3 className="font-semibold text-lg text-foreground">
                        Definir Escopo: <span className="text-primary">{selectedUserForScope.name || selectedUserForScope.email}</span>
                      </h3>
                      <p className="text-xs text-muted-foreground">Configure a quais células de produção este usuário terá acesso no painel e relatórios.</p>
                    </div>
                    <Button onClick={handleSaveScope} disabled={updateUser.isPending} className="px-5">
                      {updateUser.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-1.5" />}
                      Salvar Escopo
                    </Button>
                  </div>

                  <div className="space-y-4">
                    <Label className="text-sm font-semibold">Células Monitoradas</Label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {cells.map(c => {
                        const isChecked = selectedCells.includes(c.name);
                        return (
                          <div
                            key={c.id}
                            onClick={() => toggleCellSelection(c.name)}
                            className={`p-3 rounded-xl border cursor-pointer select-none transition-all flex items-center justify-between ${
                              isChecked
                                ? 'border-primary bg-primary/5 text-foreground font-semibold'
                                : 'border-border/60 bg-card hover:bg-secondary/40 text-muted-foreground'
                            }`}
                          >
                            <span>{c.name}</span>
                            <div className={`w-4 h-4 rounded border flex items-center justify-center ${isChecked ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/40'}`}>
                              {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="bg-primary/5 border border-primary/10 rounded-xl p-4 flex gap-3 text-xs text-muted-foreground">
                    <Shield className="w-5 h-5 text-primary shrink-0" />
                    <div>
                      <p className="font-semibold text-foreground mb-0.5">Escopo Ativo no Banco</p>
                      <p>As rotas de API e consultas Supabase usarão esta matriz de escopo para filtrar os dados em tempo de execução para este usuário, mesmo que ele tente manipular requisições manualmente no navegador.</p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                  <UserCheck className="w-12 h-12 text-muted-foreground/40 stroke-[1.5] mb-2" />
                  <p className="font-medium text-foreground">Nenhum colaborador selecionado</p>
                  <p className="text-sm">Selecione um usuário na coluna lateral para gerenciar suas restrições e escopos de célula.</p>
                </div>
              )}
            </Card>
          </div>
        </TabsContent>

        {/* ─── 3. ABA AGENDAMENTOS ────────────────────────────────── */}
        {canManageUsers && (
          <TabsContent value="schedules" className="space-y-6">
            <ReportSchedulesManager />
          </TabsContent>
        )}

        {/* ─── 4. ABA GRUPOS ──────────────────────────────────────── */}
        {canManageUsers && (
          <TabsContent value="groups" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card className="p-5 md:col-span-1 border-border/60 shadow-sm space-y-4">
                <div>
                  <h3 className="font-semibold text-lg text-foreground">
                    {editingGroup ? 'Editar Grupo' : 'Novo Grupo de E-mail'}
                  </h3>
                  <p className="text-xs text-muted-foreground">Agrupe destinatários para simplificar o disparo automatizado.</p>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!groupForm.name.trim()) return;
                    saveGroupMutation.mutate({
                      id: editingGroup?.id,
                      name: groupForm.name.trim(),
                      description: groupForm.description.trim(),
                      members: groupMembers
                    });
                  }}
                  className="space-y-4"
                >
                  <div className="space-y-1">
                    <Label htmlFor="groupName">Nome do Grupo</Label>
                    <Input
                      id="groupName"
                      value={groupForm.name}
                      onChange={(e) => setGroupForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Ex: Diretoria Industrial"
                      required
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="groupDesc">Descrição</Label>
                    <Input
                      id="groupDesc"
                      value={groupForm.description}
                      onChange={(e) => setGroupForm(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Ex: Recebe fechamento do 1º turno"
                    />
                  </div>

                  <div className="border-t border-border/40 pt-4 space-y-3">
                    <Label className="text-sm font-semibold">Integrantes do Grupo</Label>

                    {/* Adicionar Colaborador Existente */}
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Adicionar Colaborador</Label>
                      <div className="flex gap-2">
                        <Select value={newMemberProfileId} onValueChange={setNewMemberProfileId}>
                          <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Selecione colaborador...</SelectItem>
                            {users.map(u => (
                              <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button type="button" size="icon" onClick={handleAddMemberToForm} variant="outline" className="shrink-0 h-9 w-9">
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Adicionar E-mail Externo */}
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Ou E-mail Externo</Label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="diretoria@leo.com"
                          value={newMemberEmail}
                          onChange={(e) => setNewMemberEmail(e.target.value)}
                        />
                        <Button type="button" size="icon" onClick={handleAddMemberToForm} variant="outline" className="shrink-0 h-9 w-9">
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Listagem temporária de integrantes */}
                    <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                      {groupMembers.map((m, idx) => (
                        <div key={idx} className="flex justify-between items-center bg-muted/40 p-2 rounded-lg border border-border/40 text-xs">
                          <div className="truncate min-w-0 mr-2">
                            <p className="font-semibold truncate text-foreground">{m.name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{m.email}</p>
                          </div>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => handleRemoveMemberFromForm(idx)}
                            className="h-6 w-6 text-destructive hover:bg-destructive/10 shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    {editingGroup && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEditingGroup(null);
                          setGroupForm({ name: '', description: '' });
                          setGroupMembers([]);
                        }}
                        className="flex-1"
                      >
                        Cancelar
                      </Button>
                    )}
                    <Button type="submit" disabled={saveGroupMutation.isPending} className="flex-1">
                      {saveGroupMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editingGroup ? 'Salvar' : 'Criar Grupo'}
                    </Button>
                  </div>
                </form>
              </Card>

              <Card className="p-5 md:col-span-2 border-border/60 shadow-sm space-y-4">
                <h3 className="font-semibold text-lg text-foreground">Grupos Ativos</h3>
                {groups.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border border-dashed border-border rounded-xl">
                    <Mail className="w-10 h-10 text-muted-foreground/30 mb-2" />
                    <p className="font-medium text-foreground">Nenhum grupo de e-mail cadastrado</p>
                    <p className="text-xs">Crie um grupo na lateral para organizar o recebimento de fechamentos.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {groups.map(g => (
                      <Card key={g.id} className="p-4 border border-border/60 hover:border-border transition-colors flex flex-col justify-between gap-3 shadow-sm bg-card">
                        <div>
                          <div className="flex justify-between items-start gap-2">
                            <h4 className="font-semibold text-foreground text-base truncate">{g.name}</h4>
                            <Badge variant="outline" className="bg-indigo-500/5 text-indigo-600 border-indigo-500/20 text-[10px] py-0 px-2 font-medium">
                              Grupo
                            </Badge>
                          </div>
                          {g.description && <p className="text-xs text-muted-foreground mt-0.5">{g.description}</p>}
                        </div>

                        <div className="flex justify-end gap-2 border-t border-border/40 pt-3">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleEditGroupClick(g)}>
                            <Edit3 className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                            onClick={() => {
                              if (confirm('Tem certeza que deseja remover este grupo?')) {
                                deleteGroupMutation.mutate(g.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </TabsContent>
        )}

        {/* ─── 5. ABA HISTÓRICO ───────────────────────────────────── */}
        {canManageUsers && (
          <TabsContent value="history" className="space-y-6">
            <Card className="p-5 border-border/60 shadow-sm space-y-4">
              <div className="flex justify-between items-center border-b border-border/40 pb-3">
                <div>
                  <h3 className="font-semibold text-lg text-foreground">Histórico de Entregas</h3>
                  <p className="text-xs text-muted-foreground">Acompanhe o status e logs de todos os relatórios enviados via e-mail e integrados com a IA.</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => refetchHistory()} className="gap-1.5 h-8">
                  <RefreshCw className="w-3.5 h-3.5" /> Atualizar
                </Button>
              </div>

              {isLoadingHistory ? (
                <div className="flex justify-center items-center py-20 text-muted-foreground">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : deliveryHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground border border-dashed border-border rounded-xl">
                  <Clock className="w-10 h-10 text-muted-foreground/30 mb-2" />
                  <p className="font-semibold text-foreground">Nenhum log registrado</p>
                  <p className="text-xs">As tentativas de entrega serão exibidas aqui.</p>
                </div>
              ) : (
                <div className="overflow-x-auto border border-border/60 rounded-xl">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="bg-muted/40 text-muted-foreground font-semibold border-b border-border/60">
                        <th className="p-3">Data/Hora</th>
                        <th className="p-3">Destinatário</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Provedor</th>
                        <th className="p-3">Erro / Log</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {deliveryHistory.map((log) => {
                        const date = new Date(log.created_at);
                        const formattedDate = date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                        return (
                          <tr key={log.id} className="hover:bg-muted/10">
                            <td className="p-3 whitespace-nowrap text-muted-foreground">{formattedDate}</td>
                            <td className="p-3">
                              <p className="font-medium text-foreground">{log.recipient_name || log.recipient_email}</p>
                              {log.recipient_name && <p className="text-[10px] text-muted-foreground">{log.recipient_email}</p>}
                            </td>
                            <td className="p-3">
                              <Badge
                                variant="outline"
                                className={
                                  log.status === 'sent'
                                    ? 'bg-emerald-500/5 text-emerald-600 border-emerald-500/20'
                                    : log.status === 'failed'
                                    ? 'bg-destructive/5 text-destructive border-destructive/20'
                                    : 'bg-yellow-500/5 text-yellow-600 border-yellow-500/20'
                                }
                              >
                                {log.status === 'sent' ? 'Enviado' : log.status === 'failed' ? 'Falhou' : 'Fila / Processando'}
                              </Badge>
                            </td>
                            <td className="p-3 capitalize text-muted-foreground">{log.provider || 'Resend'}</td>
                            <td className="p-3 max-w-[200px] truncate text-muted-foreground font-mono text-[10px]" title={log.error_message}>
                              {log.error_message || '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </TabsContent>
        )}

        {/* ─── 6. ABA DIAGNÓSTICOS ────────────────────────────────── */}
        {canManageUsers && (
          <TabsContent value="diagnostics" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="p-5 border-border/60 shadow-sm space-y-4">
                <div>
                  <h3 className="font-semibold text-lg text-foreground">Integridade de Infraestrutura</h3>
                  <p className="text-xs text-muted-foreground">Verifique a saúde de disparo de e-mails de produção e integração SMTP.</p>
                </div>

                <div className="space-y-3.5">
                  <div className="flex justify-between items-center p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">Conexão do Provedor de E-mail</p>
                        <p className="text-[10px] text-muted-foreground">Resend API ativa & Credenciais autenticadas</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Saudável</Badge>
                  </div>

                  <div className="flex justify-between items-center p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">Serviço Cron do Servidor</p>
                        <p className="text-[10px] text-muted-foreground">Supabase claim-schedules ativado</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Ativo</Badge>
                  </div>
                </div>
              </Card>

              <Card className="p-5 border-border/60 shadow-sm space-y-4">
                <div>
                  <h3 className="font-semibold text-lg text-foreground">Disparar Relatório de Teste</h3>
                  <p className="text-xs text-muted-foreground">Teste a infraestrutura enviando um e-mail de fechamento simulado imediatamente.</p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-1">
                    <Label htmlFor="diagEmail">E-mail de Destino</Label>
                    <div className="flex gap-2">
                      <Input
                        id="diagEmail"
                        type="email"
                        value={diagnosticEmail}
                        onChange={(e) => setDiagnosticEmail(e.target.value)}
                        placeholder="Ex: gestor@empresa.com"
                      />
                      <Button
                        onClick={handleSendDiagnosticReport}
                        disabled={sendingDiagnostic}
                        className="gap-1.5 shrink-0 px-4"
                      >
                        {sendingDiagnostic ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                        Testar
                      </Button>
                    </div>
                  </div>

                  <div className="bg-muted/40 p-3 rounded-xl border border-border/40 text-[10px] text-muted-foreground font-mono space-y-1">
                    <p className="font-semibold text-foreground text-xs font-sans mb-1">Passos de Validação do Teste:</p>
                    <p>1. Chamada HTTP autenticada à Edge Function 'send-report-email'</p>
                    <p>2. Compilação do template HTML em América/São_Paulo fuso horário</p>
                    <p>3. Envio seguro via API Resend</p>
                    <p>4. Registro de log de auditoria da entrega</p>
                  </div>
                </div>
              </Card>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
