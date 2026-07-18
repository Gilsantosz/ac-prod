import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCustomerCovers, cancelCustomerCover } from '@/lib/customerCoverService';
import CustomerCoverCard from './CustomerCoverCard';
import CustomerCoverProgress from './CustomerCoverProgress';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Loader2, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { toast } from 'sonner';

export default function CustomerCoverPanel({ onActionClick }) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const isAdminOrManager = ['admin', 'manager'].includes(profile?.role);

  // Fetch covers
  const { data: covers = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['customer-covers', statusFilter, search],
    queryFn: () => getCustomerCovers({ status: statusFilter, search }),
    refetchInterval: 15000, // Auto refresh every 15 seconds
  });

  // Cancel cover mutation
  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }) => cancelCustomerCover(id, reason),
    onSuccess: () => {
      toast.success('Capa cancelada com sucesso.');
      queryClient.invalidateQueries({ queryKey: ['customer-covers'] });
      queryClient.invalidateQueries({ queryKey: ['production-lots'] });
    },
    onError: (err) => {
      toast.error(`Erro ao cancelar capa: ${err.message}`);
    }
  });

  const handleCancelCover = (cover) => {
    const reason = window.prompt('Informe o motivo do cancelamento da capa:');
    if (reason === null) return; // Cancelled prompt
    if (!reason.trim()) {
      toast.warning('O motivo do cancelamento é obrigatório.');
      return;
    }
    cancelMutation.mutate({ id: cover.id, reason });
  };

  const statuses = [
    { value: '', label: 'Todos os Status' },
    { value: 'planned', label: 'Planejado' },
    { value: 'in_production', label: 'Em Produção' },
    { value: 'ready_to_pack', label: 'Pronto para Embalar' },
    { value: 'packing', label: 'Embalando' },
    { value: 'packed', label: 'Embalado' },
    { value: 'shipped', label: 'Expedido' },
    { value: 'blocked', label: 'Bloqueado' },
    { value: 'cancelled', label: 'Cancelado' },
  ];

  return (
    <div className="space-y-6">
      {/* ── KPI Progress Summary ─────────────────────────────── */}
      {!isLoading && !isError && <CustomerCoverProgress covers={covers} />}

      {/* ── Filters & Search ─────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex-1 flex gap-2 max-w-lg">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Buscar por cliente, capa ou lote geral..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-10 rounded-xl"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 px-3 rounded-xl border border-input bg-background text-sm font-medium hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {statuses.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          <Button 
            variant="outline" 
            onClick={() => refetch()} 
            className="h-10 rounded-xl px-4"
          >
            Atualizar
          </Button>
        </div>
      </div>

      {/* ── Covers Grid ──────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm font-medium">Carregando capas de clientes...</p>
        </div>
      ) : isError ? (
        <div className="border border-destructive/20 bg-destructive/10 text-destructive text-sm rounded-2xl p-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <div>
            <h4 className="font-bold">Erro de Carregamento</h4>
            <p className="mt-1">Não foi possível recuperar as capas de clientes do banco de dados.</p>
          </div>
        </div>
      ) : covers.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border/40 rounded-2xl text-muted-foreground">
          <p className="font-bold text-foreground">Nenhuma capa de cliente encontrada</p>
          <p className="text-xs mt-1">Ajuste os filtros ou aguarde novas importações de PCP.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4.5">
          {covers.map((cover) => (
            <CustomerCoverCard
              key={cover.id}
              cover={cover}
              isAdminOrManager={isAdminOrManager}
              onActionClick={onActionClick}
              onCancelClick={handleCancelCover}
            />
          ))}
        </div>
      )}
    </div>
  );
}
