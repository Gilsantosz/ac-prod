import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { auditLog, AUDIT_ACTIONS } from '@/lib/auditLog';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Truck, CheckCircle, RefreshCw, Package, Clock, User,
  MapPin, Hash, Plus, AlertCircle, CalendarDays,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ShipmentPanel({ trace }) {
  const qc = useQueryClient();
  const [selectedLotId, setSelectedLotId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    carrier: '', vehicle: '', driver: '', tracking_code: '', notes: '',
  });

  // Lotes aguardando envio
  const readyToShip = trace.lots.data.filter(l =>
    l.current_stage === 'waiting_shipping' || l.status === 'packed'
  );

  // Expedições existentes
  const { data: shipments = [], isLoading } = useQuery({
    queryKey: ['shipments', selectedLotId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shipments')
        .select('*')
        .eq('lot_id', selectedLotId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedLotId,
    initialData: [],
  });

  const selectedLot = trace.lots.data.find(l => l.id === selectedLotId);

  // ─── Criar expedição ──────────────────────────────────────────
  const dispatch = useMutation({
    mutationFn: async () => {
      const lot = selectedLot;
      const code = `EXP-${lot.lot_code}-${Date.now()}`;

      const { data, error } = await supabase.from('shipments').insert({
        order_id:      lot.production_orders?.id || lot.order_id || lot.id,
        lot_id:        lot.id,
        shipment_code: code,
        carrier:       form.carrier || null,
        vehicle:       form.vehicle || null,
        driver:        form.driver  || null,
        tracking_code: form.tracking_code || null,
        notes:         form.notes   || null,
        shipped_at:    new Date().toISOString(),
        status:        'shipped',
      }).select().single();

      if (error) throw error;

      // Atualizar estágio do lote para Expedição
      await supabase.from('production_lots').update({
        current_stage: 'shipping',
        status:        'shipped',
      }).eq('id', lot.id);

      // Registrar evento
      await supabase.from('lot_step_events').insert({
        lot_id:     lot.id,
        step_code:  'shipping',
        event_type: 'finish',
        notes:      `Expedição: ${code}${form.carrier ? ` · ${form.carrier}` : ''}`,
        quantity:   0,
      });

      return data;
    },
    onSuccess: async (data) => {
      qc.invalidateQueries({ queryKey: ['shipments', selectedLotId] });
      qc.invalidateQueries({ queryKey: ['production-lots'] });
      await auditLog(AUDIT_ACTIONS.SHIPMENT_DISPATCH, 'shipment', data.id, {
        lotId: selectedLotId, shipmentCode: data.shipment_code
      });
      toast.success(`🚛 Expedição ${data.shipment_code} registrada com sucesso!`);
      setShowForm(false);
      setForm({ carrier: '', vehicle: '', driver: '', tracking_code: '', notes: '' });
    },
    onError: (e) => toast.error(e?.message),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
      {/* ── Lotes para expedir ──────────────────────────────────── */}
      <div className="lg:col-span-1 space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Aguardando Expedição
        </h3>

        {readyToShip.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground border border-dashed border-border/40 rounded-2xl">
            <Truck className="w-6 h-6 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhum lote aguardando expedição</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
            {readyToShip.map(lot => (
              <button
                key={lot.id}
                onClick={() => setSelectedLotId(lot.id)}
                className={cn(
                  'w-full text-left px-4 py-3 rounded-xl border transition-all duration-150',
                  selectedLotId === lot.id
                    ? 'border-violet-400/60 bg-violet-50/20 dark:bg-violet-950/20 shadow-sm'
                    : 'border-border/50 bg-card hover:border-border/80'
                )}
              >
                <p className="font-semibold text-sm text-foreground">{lot.lot_code}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {lot.production_orders?.customer_name}
                </p>
                {lot.production_orders?.delivery_date && (
                  <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                    <CalendarDays className="w-2.5 h-2.5" />
                    {new Date(lot.production_orders.delivery_date).toLocaleDateString('pt-BR')}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Painel de Expedição ──────────────────────────────────── */}
      <div className="lg:col-span-2 space-y-4">
        {!selectedLotId ? (
          <div className="text-center py-20 border border-dashed border-border/40 rounded-2xl text-muted-foreground">
            <Truck className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-foreground">Selecione um lote para registrar a expedição</p>
          </div>
        ) : (
          <>
            {/* Header */}
            {selectedLot && (
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="font-bold text-foreground">{selectedLot.lot_code}</h3>
                  <p className="text-sm text-muted-foreground">
                    {selectedLot.production_orders?.customer_name} · {selectedLot.production_orders?.order_code}
                  </p>
                </div>
                {!showForm && (
                  <Button
                    className="gap-2 bg-violet-600 hover:bg-violet-700 text-white"
                    onClick={() => setShowForm(true)}
                  >
                    <Truck className="w-4 h-4" /> Registrar Expedição
                  </Button>
                )}
              </div>
            )}

            {/* Formulário de expedição */}
            {showForm && (
              <div className="bg-card border border-violet-200/60 dark:border-violet-800/40 rounded-2xl p-5 space-y-4">
                <h4 className="font-semibold text-foreground flex items-center gap-2">
                  <Truck className="w-4 h-4 text-violet-600" /> Nova Expedição
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { key: 'carrier',       label: 'Transportadora',   placeholder: 'Ex: Correios, FedEx…' },
                    { key: 'vehicle',       label: 'Veículo / Placa',  placeholder: 'Ex: ABC-1234' },
                    { key: 'driver',        label: 'Motorista',        placeholder: 'Nome do motorista' },
                    { key: 'tracking_code', label: 'Código de Rastreio', placeholder: 'Código de rastreio' },
                  ].map(f => (
                    <div key={f.key} className="space-y-1.5">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {f.label}
                      </label>
                      <input
                        value={form[f.key]}
                        onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                        placeholder={f.placeholder}
                        className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Observações
                  </label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                    placeholder="Instruções especiais, condições de entrega…"
                    className="flex w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none h-16"
                  />
                </div>
                <div className="flex justify-end gap-3 pt-1 border-t border-border/60">
                  <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
                  <Button
                    className="gap-2 bg-violet-600 hover:bg-violet-700 text-white"
                    onClick={() => dispatch.mutate()}
                    disabled={dispatch.isPending}
                  >
                    {dispatch.isPending
                      ? <RefreshCw className="w-4 h-4 animate-spin" />
                      : <CheckCircle className="w-4 h-4" />
                    }
                    Confirmar Expedição
                  </Button>
                </div>
              </div>
            )}

            {/* Histórico de expedições */}
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Expedições ({shipments.length})
            </h4>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin" /> Carregando…
              </div>
            ) : shipments.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-border/40 rounded-2xl text-muted-foreground">
                <Package className="w-6 h-6 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Nenhuma expedição registrada</p>
              </div>
            ) : (
              <div className="space-y-3">
                {shipments.map(s => (
                  <div key={s.id} className="bg-card border border-border/60 rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-sm text-foreground font-mono">{s.shipment_code}</p>
                      <Badge className={cn(
                        'text-xs',
                        s.status === 'shipped'   && 'bg-violet-600 text-white border-0',
                        s.status === 'delivered' && 'bg-emerald-600 text-white border-0',
                      )}>
                        {s.status === 'shipped' ? '🚛 Em trânsito' : '✓ Entregue'}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {s.carrier       && <span className="flex items-center gap-1"><Truck className="w-3 h-3" />{s.carrier}</span>}
                      {s.driver        && <span className="flex items-center gap-1"><User className="w-3 h-3" />{s.driver}</span>}
                      {s.tracking_code && <span className="flex items-center gap-1"><Hash className="w-3 h-3" />{s.tracking_code}</span>}
                      {s.shipped_at    && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(s.shipped_at).toLocaleString('pt-BR')}</span>}
                    </div>
                    {s.notes && <p className="text-xs text-muted-foreground italic">{s.notes}</p>}
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
