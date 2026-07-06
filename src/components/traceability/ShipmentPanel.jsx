import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import { auditLog, AUDIT_ACTIONS } from '@/lib/auditLog';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Truck, CheckCircle, RefreshCw, Package, Clock, User, Hash, CalendarDays,
  QrCode, Play, AlertCircle, ShieldAlert, Check, ArrowRight
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  createShipmentChecklist,
  scanShipmentItem,
  validateShipmentCompleteness,
  releaseShipment,
  createShipmentException,
  getMissingShipmentItems,
  getShipmentProgress
} from '@/lib/shipmentService';

export default function ShipmentPanel({ trace }) {
  const qc = useQueryClient();
  const [selectedLotId, setSelectedLotId] = useState(null);
  const [activeShipmentId, setActiveShipmentId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [exceptionReason, setExceptionReason] = useState('');
  const [selectedExceptionItem, setSelectedExceptionItem] = useState(null);

  const [form, setForm] = useState({
    carrier: '', vehicle: '', driver: '', tracking_code: '', notes: '',
  });

  // Lotes embalados aguardando expedição
  const readyToShip = trace.lots.data.filter(l =>
    l.status === 'packed' || l.status === 'waiting_shipping'
  );

  // Expedições do lote selecionado
  const { data: shipments = [], isLoading: isLoadingShipments, refetch: refetchShipments } = useQuery({
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

  // Progresso de conferência da expedição ativa
  const { data: progress, refetch: refetchProgress } = useQuery({
    queryKey: ['shipment-progress', activeShipmentId],
    queryFn: () => getShipmentProgress(activeShipmentId),
    enabled: !!activeShipmentId,
  });

  const selectedLot = trace.lots.data.find(l => l.id === selectedLotId);
  const activeShipment = shipments.find(s => s.id === activeShipmentId);

  // Auto-selecionar shipment ativa se houver
  useEffect(() => {
    if (shipments && shipments.length > 0) {
      if (!activeShipmentId || !shipments.some(s => s.id === activeShipmentId)) {
        setActiveShipmentId(shipments[0].id);
      }
    } else {
      setActiveShipmentId(null);
    }
  }, [shipments, activeShipmentId]);

  // ─── Criar Expedição & Checklist ──────────────────────────────
  const handleCreateShipment = async (e) => {
    e.preventDefault();
    if (!selectedLot) return;

    try {
      const code = `EXP-${selectedLot.lot_code}-${Date.now()}`;
      
      const { data: shipment, error } = await supabase.from('shipments').insert({
        order_id:      selectedLot.production_orders?.id || selectedLot.order_id || selectedLot.id,
        lot_id:        selectedLot.id,
        shipment_code: code,
        carrier:       form.carrier || null,
        vehicle:       form.vehicle || null,
        driver:        form.driver  || null,
        tracking_code: form.tracking_code || null,
        notes:         form.notes   || null,
        status:        'pending',
      }).select().single();

      if (error) throw error;

      // Criar o checklist físico de itens esperados
      await createShipmentChecklist(shipment.id);

      toast.success(`🚛 Controle de Expedição ${code} criado! Bipar volumes para liberar.`);
      setShowForm(false);
      setForm({ carrier: '', vehicle: '', driver: '', tracking_code: '', notes: '' });
      refetchShipments();
      setActiveShipmentId(shipment.id);
    } catch (e) {
      toast.error(e?.message || 'Erro ao registrar expedição');
    }
  };

  // ─── Bipar Item (peça ou volume) ──────────────────────────────
  const handleScanSubmit = async (e) => {
    e.preventDefault();
    if (!barcodeInput.trim() || !activeShipmentId) return;

    setIsScanning(true);
    try {
      await scanShipmentItem(activeShipmentId, barcodeInput.trim());
      toast.success('✓ Item conferido na expedição!');
      setBarcodeInput('');
      refetchProgress();
    } catch (err) {
      toast.error(err.message || 'Falha ao bipar item de expedição');
    } finally {
      setIsScanning(false);
    }
  };

  // ─── Liberar Carga Oficialmente ───────────────────────────────
  const handleReleaseShipment = async () => {
    if (!activeShipmentId) return;
    try {
      await releaseShipment(activeShipmentId, 'Expedição física autorizada.');
      toast.success('🚛 CARGA EXPEDIDA! Lote atualizado para Enviado.');
      refetchShipments();
      refetchProgress();
      qc.invalidateQueries({ queryKey: ['production-lots'] });
    } catch (err) {
      toast.error(err.message || 'Bloqueio de liberação.');
    }
  };

  // ─── Aprovar Exceção ──────────────────────────────────────────
  const handleApproveException = async (e) => {
    e.preventDefault();
    if (!selectedExceptionItem || !exceptionReason.trim()) return;

    try {
      await createShipmentException(activeShipmentId, {
        pieceId: selectedExceptionItem.piece_id,
        volumeId: selectedExceptionItem.volume_id,
        reason: exceptionReason
      });

      toast.warning('Aviso: Exceção aprovada para este item.');
      setSelectedExceptionItem(null);
      setExceptionReason('');
      refetchProgress();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
      {/* ── Lotes prontos para expedir ──────────────────────────── */}
      <div className="lg:col-span-1 space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Lotes Prontos para Expedir (Embalados)
        </h3>

        {readyToShip.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground border border-dashed border-border/40 rounded-2xl">
            <Truck className="w-6 h-6 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhum lote embalado aguardando envio</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
            {readyToShip.map(lot => (
              <button
                key={lot.id}
                onClick={() => {
                  setSelectedLotId(lot.id);
                  setActiveShipmentId(null);
                }}
                className={cn(
                  'w-full text-left px-4 py-3 rounded-xl border transition-all duration-150',
                  selectedLotId === lot.id
                    ? 'border-[#76FB91]/60 bg-[#76FB91]/5 shadow-sm'
                    : 'border-border/50 bg-card hover:border-border/80'
                )}
              >
                <p className="font-semibold text-sm text-foreground">{lot.lot_code}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {lot.production_orders?.customer_name || 'Móvel Planejado'}
                </p>
                <Badge variant="outline" className="text-[10px] mt-1 bg-emerald-500/10 text-emerald-500 border-0">
                  Embalado
                </Badge>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Painel de Conferência de Carga ───────────────────────── */}
      <div className="lg:col-span-2 space-y-4">
        {!selectedLotId ? (
          <div className="text-center py-20 border border-dashed border-border/40 rounded-2xl text-muted-foreground">
            <Truck className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-foreground">Selecione um lote embalado</p>
            <p className="text-sm mt-1">Configure a transportadora e realize a bipagem dos volumes para liberação física</p>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-start gap-2 flex-wrap bg-secondary/10 border border-border/40 rounded-2xl p-4">
              <div>
                <h3 className="font-bold text-foreground text-base">{selectedLot.lot_code}</h3>
                <p className="text-xs text-muted-foreground">
                  Cliente: {selectedLot.production_orders?.customer_name || 'Móvel Sob Medida'}
                </p>
              </div>
              <div className="flex gap-2">
                <Button asChild variant="outline" size="sm" className="h-8 text-[11px] gap-1">
                  <Link to="/rastreabilidade?tab=timeline">
                    Histórico / Timeline
                  </Link>
                </Button>
                {shipments.length === 0 && !showForm && (
                  <Button className="bg-[#2d9c4a] hover:bg-[#25813d] text-white h-8 text-[11px]" onClick={() => setShowForm(true)}>
                    Iniciar Expedição
                  </Button>
                )}
              </div>
            </div>

            {/* Formulário de Configuração de Carga */}
            {showForm && (
              <form onSubmit={handleCreateShipment} className="border border-border/60 bg-card rounded-2xl p-4 space-y-4">
                <h4 className="font-bold text-sm text-foreground">Configurar Carga / Transporte</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Transportadora</Label>
                    <Input className="h-9 mt-1" value={form.carrier} onChange={e => setForm({ ...form, carrier: e.target.value })} placeholder="Ex: Braspress" />
                  </div>
                  <div>
                    <Label className="text-xs">Placa do Veículo</Label>
                    <Input className="h-9 mt-1" value={form.vehicle} onChange={e => setForm({ ...form, vehicle: e.target.value })} placeholder="Ex: ABC-1234" />
                  </div>
                  <div>
                    <Label className="text-xs">Motorista</Label>
                    <Input className="h-9 mt-1" value={form.driver} onChange={e => setForm({ ...form, driver: e.target.value })} placeholder="Nome Completo" />
                  </div>
                  <div>
                    <Label className="text-xs">Código Rastreio</Label>
                    <Input className="h-9 mt-1" value={form.tracking_code} onChange={e => setForm({ ...form, tracking_code: e.target.value })} placeholder="Opcional" />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancelar</Button>
                  <Button type="submit" size="sm" className="bg-[#2d9c4a] hover:bg-[#25813d] text-white">Criar Checklist</Button>
                </div>
              </form>
            )}

            {/* Detalhes de Expedição Criada */}
            {activeShipment && (
              <div className="space-y-4">
                <div className="border border-border/60 bg-card/30 rounded-2xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                  <div>
                    <p className="text-muted-foreground">Código de Carga</p>
                    <p className="font-bold font-mono">{activeShipment.shipment_code}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Transporte</p>
                    <p className="font-bold">{activeShipment.carrier || 'Fábrica'} - {activeShipment.vehicle || 'Sem Placa'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Motorista</p>
                    <p className="font-bold">{activeShipment.driver || 'Não informado'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <Badge variant={activeShipment.status === 'shipped' ? 'default' : 'outline'} className={cn(
                      activeShipment.status === 'shipped' && 'bg-violet-600 text-white border-0'
                    )}>
                      {activeShipment.status === 'shipped' ? 'Expedido' : 'Pendente'}
                    </Badge>
                  </div>
                </div>

                {/* Checklist e Bipagem */}
                {progress && (
                  <div className="border border-border/60 bg-card rounded-2xl p-4 space-y-4">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-muted-foreground">Checklist de Conferência Carga</span>
                      <span className="font-bold text-foreground">
                        {progress.scanned + progress.exceptions} / {progress.total} itens ({progress.percent}%)
                      </span>
                    </div>

                    <div className="w-full bg-secondary h-2.5 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-300',
                          progress.percent === 100 ? 'bg-emerald-500' : 'bg-violet-500'
                        )}
                        style={{ width: `${progress.percent}%` }}
                      />
                    </div>

                    {/* Formulário de Bipagem se Pendente */}
                    {activeShipment.status === 'pending' ? (
                      <div className="space-y-3">
                        <form onSubmit={handleScanSubmit} className="flex gap-2">
                          <div className="relative flex-1">
                            <QrCode className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                            <Input
                              placeholder="Bipar Etiqueta do Volume ou Peça Solta"
                              value={barcodeInput}
                              onChange={(e) => setBarcodeInput(e.target.value)}
                              className="pl-9 h-9"
                              disabled={isScanning}
                              autoFocus
                            />
                          </div>
                          <Button
                            type="submit"
                            size="sm"
                            className="bg-secondary hover:bg-secondary/80 h-9"
                            disabled={isScanning || !barcodeInput.trim()}
                          >
                            {isScanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                          </Button>
                        </form>

                        <div className="flex justify-between items-center gap-3 pt-2">
                          <p className="text-[11px] text-muted-foreground">
                            Bipe todas as caixas. A liberação física está bloqueada até 100% de conformidade.
                          </p>
                          <Button
                            size="sm"
                            className={cn(
                              'text-white transition-all h-8',
                              progress.percent === 100
                                ? 'bg-emerald-600 hover:bg-emerald-700'
                                : 'bg-gray-400 cursor-not-allowed'
                            )}
                            disabled={progress.percent < 100}
                            onClick={handleReleaseShipment}
                          >
                            Liberar Expedição
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-emerald-500/5 border border-emerald-500/20 text-emerald-600 rounded-xl p-3 flex items-center gap-2 text-xs">
                        <CheckCircle className="w-4 h-4 shrink-0" />
                        <span>Carga despachada com sucesso da fábrica! Registro em trânsito.</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Lista de Itens Faltantes / Checklist pendente */}
                {progress && progress.pendingItems?.length > 0 && (
                  <div className="border border-border/60 bg-card rounded-2xl p-4 space-y-3">
                    <h4 className="font-bold text-sm text-foreground flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                      <span>Itens Faltantes no Carregamento ({progress.pendingItems.length})</span>
                    </h4>
                    <div className="space-y-2 max-h-[30vh] overflow-y-auto">
                      {progress.pendingItems.map(item => (
                        <div key={item.id} className="flex justify-between items-center gap-4 p-3 bg-secondary/20 rounded-xl border text-xs">
                          <div>
                            <p className="font-bold font-mono">{item.traceability_code}</p>
                            <p className="text-muted-foreground text-[10px]">
                              Tipo: {item.expected_type === 'volume' ? '📦 Volume Fechado' : 'Piece'} ·
                              Etapa Atual: {item.production_pieces?.current_stage || 'Não embalado'}
                            </p>
                          </div>
                          {activeShipment.status === 'pending' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-[10px] text-amber-600 border-amber-300 hover:bg-amber-50 h-7"
                              onClick={() => setSelectedExceptionItem(item)}
                            >
                              Liberar Exceção
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Modal de Exceção */}
            {selectedExceptionItem && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="bg-card border border-border/60 max-w-md w-full rounded-2xl p-5 space-y-4 shadow-xl">
                  <div className="flex items-center gap-2 text-amber-500">
                    <ShieldAlert className="w-5 h-5" />
                    <h3 className="font-bold text-foreground text-sm">Aprovar Exceção de Carga</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Você está liberando manualmente o item <strong>{selectedExceptionItem.traceability_code}</strong> sem bipagem.
                    Esta ação será registrada e requer perfil de Gerente/Admin.
                  </p>
                  <form onSubmit={handleApproveException} className="space-y-4">
                    <div>
                      <Label className="text-xs">Motivo da Exceção</Label>
                      <Input
                        required
                        className="mt-1"
                        placeholder="Ex: Peça avulsa enviada em lote de assistência..."
                        value={exceptionReason}
                        onChange={e => setExceptionReason(e.target.value)}
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setSelectedExceptionItem(null)}>Cancelar</Button>
                      <Button type="submit" size="sm" className="bg-amber-600 hover:bg-amber-700 text-white gap-1">
                        <Check className="w-3 h-3" /> Autorizar
                      </Button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
