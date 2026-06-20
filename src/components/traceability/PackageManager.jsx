import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { auditLog, AUDIT_ACTIONS } from '@/lib/auditLog';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Box, Plus, CheckCircle, RefreshCw, Package, Layers,
  Lock, Unlock, ChevronRight, AlertCircle, Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function PackageManager({ trace }) {
  const qc = useQueryClient();
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [creatingPackage, setCreatingPackage] = useState(false);

  // ─── Ordens prontas para embalar ─────────────────────────────
  const readyOrders = trace.lots.data.filter(l =>
    l.current_stage === 'separation' || l.current_stage === 'packaging'
  );

  // ─── Embalagens da ordem selecionada ─────────────────────────
  const { data: packages = [], isLoading } = useQuery({
    queryKey: ['packages', selectedOrderId],
    queryFn: async () => {
      if (!selectedOrderId) return [];
      const { data, error } = await supabase
        .from('packages')
        .select('*, package_items(id, lot_item_id, quantity, lot_items(piece_name, piece_code))')
        .eq('lot_id', selectedOrderId)
        .order('volume_number', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedOrderId,
    initialData: [],
  });

  const selectedLot = trace.lots.data.find(l => l.id === selectedOrderId);

  // ─── Criar novo volume ────────────────────────────────────────
  const createPackage = useMutation({
    mutationFn: async ({ lotId, orderId }) => {
      const existingCount = packages.length;
      const volumeNumber = existingCount + 1;
      const { data: lot } = await supabase
        .from('production_lots')
        .select('production_orders(order_code)')
        .eq('id', lotId)
        .single();

      const packageCode = `${lot?.production_orders?.order_code}-V${String(volumeNumber).padStart(3, '0')}-${Date.now()}`;

      const { data, error } = await supabase.from('packages').insert({
        lot_id:        lotId,
        order_id:      orderId || lotId,
        package_code:  packageCode,
        volume_number: volumeNumber,
        status:        'open',
        total_items:   0,
      }).select().single();

      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      qc.invalidateQueries({ queryKey: ['packages', selectedOrderId] });
      await auditLog(AUDIT_ACTIONS.PACKAGE_CREATE, 'package', data.id, { lotId: selectedOrderId });
      toast.success(`📦 Volume ${data.volume_number} criado: ${data.package_code}`);
    },
    onError: (e) => toast.error(e?.message),
  });

  // ─── Fechar volume ────────────────────────────────────────────
  const closePackage = useMutation({
    mutationFn: async (packageId) => {
      const { error } = await supabase.from('packages').update({
        status:    'closed',
        closed_at: new Date().toISOString(),
      }).eq('id', packageId);
      if (error) throw error;
      return packageId;
    },
    onSuccess: async (pkgId) => {
      qc.invalidateQueries({ queryKey: ['packages', selectedOrderId] });
      await auditLog(AUDIT_ACTIONS.PACKAGE_CLOSE, 'package', pkgId, { lotId: selectedOrderId });
      toast.success('📦 Volume fechado!');
    },
    onError: (e) => toast.error(e?.message),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
      {/* ── Lista de Lotes prontos para embalar ─────────────────── */}
      <div className="lg:col-span-1 space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Lotes em Separação / Embalagem
        </h3>

        {readyOrders.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground border border-dashed border-border/40 rounded-2xl">
            <Box className="w-6 h-6 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhum lote pronto para embalar</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
            {readyOrders.map(lot => (
              <button
                key={lot.id}
                onClick={() => setSelectedOrderId(lot.id)}
                className={cn(
                  'w-full text-left px-4 py-3 rounded-xl border transition-all duration-150',
                  selectedOrderId === lot.id
                    ? 'border-[#76FB91]/60 bg-[#76FB91]/5 shadow-sm'
                    : 'border-border/50 bg-card hover:border-border/80'
                )}
              >
                <p className="font-semibold text-sm text-foreground">{lot.lot_code}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {lot.production_orders?.customer_name}
                </p>
                <Badge variant="outline" className="text-[10px] mt-1">
                  {lot.current_stage === 'separation' ? 'Separação' : 'Embalagem'}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Volumes do Lote Selecionado ──────────────────────────── */}
      <div className="lg:col-span-2 space-y-4">
        {!selectedOrderId ? (
          <div className="text-center py-20 border border-dashed border-border/40 rounded-2xl text-muted-foreground">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-foreground">Selecione um lote para gerenciar embalagens</p>
            <p className="text-sm mt-1">Crie volumes e adicione peças para controle de expedição</p>
          </div>
        ) : (
          <>
            {selectedLot && (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="font-bold text-foreground">{selectedLot.lot_code}</h3>
                  <p className="text-sm text-muted-foreground">
                    {selectedLot.production_orders?.customer_name}
                  </p>
                </div>
                <Button
                  className="gap-2 bg-[#2d9c4a] hover:bg-[#25813d] text-white"
                  onClick={() => createPackage.mutate({
                    lotId:   selectedOrderId,
                    orderId: selectedLot.production_orders?.id,
                  })}
                  disabled={createPackage.isPending}
                >
                  {createPackage.isPending
                    ? <RefreshCw className="w-4 h-4 animate-spin" />
                    : <Plus className="w-4 h-4" />
                  }
                  Novo Volume
                </Button>
              </div>
            )}

            {isLoading ? (
              <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin" /> Carregando volumes…
              </div>
            ) : packages.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-border/40 rounded-2xl text-muted-foreground">
                <Box className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Nenhum volume criado</p>
                <p className="text-xs mt-1">Clique em "Novo Volume" para começar a embalar</p>
              </div>
            ) : (
              <div className="space-y-3">
                {packages.map(pkg => (
                  <div
                    key={pkg.id}
                    className={cn(
                      'border rounded-2xl p-4 space-y-3',
                      pkg.status === 'closed'
                        ? 'bg-emerald-50/20 dark:bg-emerald-950/10 border-emerald-200/60 dark:border-emerald-800/40'
                        : 'bg-card border-border/60'
                    )}
                  >
                    {/* Header do volume */}
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          'w-8 h-8 rounded-lg flex items-center justify-center',
                          pkg.status === 'closed'
                            ? 'bg-emerald-100 dark:bg-emerald-900/30'
                            : 'bg-secondary/60'
                        )}>
                          <Box className={cn(
                            'w-4 h-4',
                            pkg.status === 'closed' ? 'text-emerald-600' : 'text-muted-foreground'
                          )} />
                        </div>
                        <div>
                          <p className="font-semibold text-sm text-foreground">
                            Volume {pkg.volume_number}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono">{pkg.package_code}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={pkg.status === 'closed' ? 'default' : 'outline'} className={cn(
                          'text-xs',
                          pkg.status === 'closed' && 'bg-emerald-600 text-white border-0'
                        )}>
                          {pkg.status === 'closed' ? '✓ Fechado' : '● Aberto'}
                        </Badge>
                        {pkg.status === 'open' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:border-emerald-800/60"
                            onClick={() => closePackage.mutate(pkg.id)}
                            disabled={closePackage.isPending}
                          >
                            <Lock className="w-3 h-3" /> Fechar Volume
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Itens do volume */}
                    {pkg.package_items && pkg.package_items.length > 0 ? (
                      <div className="space-y-1">
                        {pkg.package_items.map(item => (
                          <div key={item.id} className="flex items-center gap-2 text-xs text-muted-foreground py-1 border-t border-border/30">
                            <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0" />
                            <span className="flex-1 truncate">{item.lot_items?.piece_name || item.lot_item_id}</span>
                            <span className="font-medium">×{item.quantity}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        Nenhuma peça adicionada a este volume
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
