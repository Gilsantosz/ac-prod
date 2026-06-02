import { useState } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShieldAlert } from 'lucide-react';
import InviteUserForm from '@/components/users/InviteUserForm';
import UserList from '@/components/users/UserList';

export default function Users() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => base44.auth.me(),
  });

  const { data: users = [], isError } = useQuery({
    queryKey: ['users'],
    queryFn: () => base44.entities.User.list('-created_date', 200),
    initialData: [],
    enabled: me?.role === 'admin',
  });

  const invite = useMutation({
    // Aceitando e repassando o campo de célula vinculada
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
    mutationFn: (id) => base44.entities.User.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Colaborador excluído do sistema.');
    },
    onError: () => toast.error('Falha ao excluir colaborador'),
  });

  const handleInvite = async (email, role, name, password, permissions, cell) => {
    setSaving(true);
    await invite.mutateAsync({ email, role, name, password, permissions, cell }).catch(() => {});
    setSaving(false);
  };

  if (me && me.role !== 'admin') {
    return (
      <div className="p-6 lg:p-8 max-w-3xl mx-auto">
        <div className="flex flex-col items-center text-center gap-3 py-20 text-muted-foreground border border-dashed border-border rounded-2xl">
          <ShieldAlert className="w-10 h-10" />
          <p className="font-medium text-foreground">Acesso restrito</p>
          <p>Apenas administradores podem gerenciar usuários e acessos.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="bg-card/40 backdrop-blur-md border border-border/40 p-5 rounded-2xl shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 hover:shadow-md transition-all duration-300">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground bg-gradient-to-r from-foreground via-foreground/90 to-foreground/80 bg-clip-text">Usuários e Acessos</h1>
          <p className="text-muted-foreground text-sm mt-1">Cadastre novos colaboradores, configure senhas e defina o nível granular de acesso de cada um.</p>
        </div>
      </div>

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
        />
      )}
    </div>
  );
}