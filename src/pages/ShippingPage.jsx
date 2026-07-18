import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/ui/PageHeader';
import {
  Truck, CheckCircle, RefreshCw, Package, Clock,
  QrCode, Play, AlertCircle, Layers, ArrowRight, Check
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  createShipmentChecklist,
  scanShipmentItem,
  validateShipmentCompleteness,
  releaseShipment,
  getShipmentProgress
} from '@/lib/shipmentService';
import { getCustomerCovers } from '@/lib/customerCoverService';
import { Label } from '@/components/ui/label';

// Função para gerar feedback sonoro nativo via Web Audio API
const playBeep = (type) => {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'success') {
      osc.frequency.setValueAtTime(880, ctx.currentTime); // La (A5)
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } else {
      osc.frequency.setValueAtTime(150, ctx.currentTime); // Grave
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    }
  } catch (err) {
    console.warn('Erro ao tocar feedback sonoro:', err);
  }
};

export default function ShippingPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('covers'); // 'covers' | 'lots'
  const [selectedLotId, setSelectedLotId] = useState(null);
  const [selectedCoverId, setSelectedCoverId] = useState(null);
  const [activeShipmentId, setActiveShipmentId] = useState(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [scanFeedback, setScanFeedback] = useState(null);
  const scannerInputRef = useRef(null);

  const [form, setForm] = useState({
    carrier: '', vehicle: '', driver: '', tracking_code: '', notes: '',
  });

  // 1. Query: Lotes MES prontos ou aguardando expedição
  const { data: lots = [], isLoading: isLoadingLots, refetch: refetchLots } = useQuery({
    queryKey: ['mes-shipping-lots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_lots')
        .select(`
          id,
          lot_code,
          status,
          order_id,
          deadline,
          created_at,
          production_orders:production_orders!production_order_id (
            id,
            order_code,
            customer_name
          )
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  const readyToShip = lots.filter(l =>
    l.status === 'packed' || l.status === 'waiting_shipping' || l.status === 'completed'
  );

  // 2. Query: Capas de cliente
  const { data: covers = [], isLoading: isLoadingCovers, refetch: refetchCovers } = useQuery({
    queryKey: ['mes-shipping-covers'],
    queryFn: () => getCustomerCovers(),
  });

  const readyCovers = covers.filter(c =>
    c.status === 'packed' || c.status === 'shipped'
  );

  // 3. Query: Expedições associadas ao lote/capa ativo
  const { data: shipments = [], isLoading: isLoadingShipments, refetch: refetchShipments } = useQuery({
    queryKey: ['shipments', activeTab === 'covers' ? selectedCoverId : selectedLotId, activeTab],
    queryFn: async () => {
      const targetId = activeTab === 'covers' ? selectedCoverId : selectedLotId;
      if (!targetId) return [];
      let query = supabase.from('shipments').select('*');
      if (activeTab === 'covers') {
        query = query.eq('customer_cover_id', targetId);
      } else {
        query = query.eq('lot_id', targetId);
      }
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: activeTab === 'covers' ? !!selectedCoverId : !!selectedLotId,
    initialData: [],
  });

  // 4. Query: Progresso da conferência da expedição selecionada
  const { data: progress, isLoading: isLoadingProgress, refetch: refetchProgress } = useQuery({
    queryKey: ['shipment-progress', activeShipmentId],
    queryFn: () => getShipmentProgress(activeShipmentId),
    enabled: !!activeShipmentId,
  });

  const selectedLot = lots.find(l => l.id === selectedLotId);
  const selectedCover = covers.find(c => c.id === selectedCoverId);
  const activeShipment = shipments.find(s => s.id === activeShipmentId);

  // Auto-seleciona a primeira expedição do lote/capa
  useEffect(() => {
    if (shipments && shipments.length > 0) {
      if (!activeShipmentId || !shipments.some(s => s.id === activeShipmentId)) {
        setActiveShipmentId(shipments[0].id);
      }
    } else {
      setActiveShipmentId(null);
    }
  }, [shipments, activeShipmentId]);

  // Mantém foco do scanner
  useEffect(() => {
    if (activeShipment && activeShipment.status === 'pending' && scannerInputRef.current) {
      scannerInputRef.current.focus();
    }
  }, [activeShipment, activeShipmentId, isScanning]);

  // KPIs dinâmicos da Expedição
  const kpis = {
    waiting: activeTab === 'covers'
      ? readyCovers.filter(c => c.status === 'packed').length
      : readyToShip.filter(l => l.status === 'packed' || l.status === 'waiting_shipping').length,
    inProgress: shipments.filter(s => s.status === 'pending').length,
    blocked: activeTab === 'covers'
      ? covers.filter(c => c.status === 'blocked').length
      : readyToShip.filter(l => l.status === 'blocked').length,
    releasedToday: shipments.filter(s =>
      (s.status === 'shipped' || s.status === 'released') &&
      new Date(s.shipped_at || s.released_at || s.created_at).toDateString() === new Date().toDateString()
    ).length
  };

  const handleCreateShipment = async (e) => {
    e.preventDefault();
    const target = activeTab === 'covers' ? selectedCover : selectedLot;
    if (!target) return;

    try {
      let code;
      let payload = {
        carrier:       form.carrier || null,
        vehicle:       form.vehicle || null,
        driver:        form.driver  || null,
        tracking_code: form.tracking_code || null,
        notes:         form.notes   || null,
        status:        'pending',
      };

      if (activeTab === 'covers') {
        code = `EXP-${target.cover_code}-${Date.now()}`;
        payload.customer_cover_id = target.id;
        payload.shipment_code = code;
      } else {
        code = `EXP-${target.lot_code}-${Date.now()}`;
        payload.order_id = target.production_orders?.id || target.order_id || target.id;
        payload.lot_id = target.id;
        payload.shipment_code = code;
      }

      const { data: shipment, error } = await supabase
        .from('shipments')
        .insert(payload)
        .select()
        .single();

      if (error) throw error;

      await createShipmentChecklist(shipment.id);
      toast.success('📦 Guia de Expedição e Checklist gerados!');
      refetchShipments();
      setShowForm(false);
      playBeep('success');
    } catch (err) {
      toast.error('Erro ao gerar checklist de expedição');
      playBeep('error');
    }
  };

  const handleScanSubmit = async (e) => {
    e.preventDefault();
    const barcode = barcodeInput.trim();
    if (!barcode || !activeShipmentId) return;

    setIsScanning(true);
    setScanFeedback(null);

    try {
      await scanShipmentItem(activeShipmentId, barcode);
      setScanFeedback({
        type: 'success',
        message: `Volume "${barcode.split('-V')[1] || barcode}" conferido com sucesso na carga!`
      });
      playBeep('success');
      setBarcodeInput('');
      refetchProgress();
    } catch (err) {
      setScanFeedback({
        type: 'error',
        message: err.message || 'Código incorreto ou volume já conferido.'
      });
      playBeep('error');
    } finally {
      setIsScanning(false);
    }
  };

  const handleReleaseShipment = async () => {
    if (!activeShipmentId) return;

    try {
      // Validar completude
      const validation = await validateShipmentCompleteness(activeShipmentId);
      if (!validation.isValid) {
        toast.error(`Não é possível liberar: existem ${validation.pending} volumes pendentes de conferência.`);
        playBeep('error');
        return;
      }

      await releaseShipment(activeShipmentId);
      toast.success('🚀 Carga expedida e integrada com sucesso!');
      refetchShipments();
      if (activeTab === 'covers') {
        refetchCovers();
      } else {
        refetchLots();
      }
      refetchProgress();
      playBeep('success');
    } catch (err) {
      toast.error(err.message || 'Falha ao liberar carga');
      playBeep('error');
    }
  };

  // Listagem de volumes e peças para o checklist
  const volumes = progress?.items || [];
  const missingVolumes = volumes.filter(v => v.status === 'pending');

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      
      {/* ── Topo com Fluxo MES ──────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/60 pb-5">
        <PageHeader
          title="Expedição de Cargas"
          subtitle="Confira volumes, realize checklists e libere entregas completas sem erros."
          icon={Truck}
        />
        
        {/* Barra de Progresso MES */}
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground bg-secondary/30 p-2 rounded-xl border border-border/50">
          <span>PCP</span>
          <ArrowRight className="w-3 h-3" />
          <span>Produção</span>
          <ArrowRight className="w-3 h-3" />
          <span>Embalagem</span>
          <ArrowRight className="w-3 h-3" />
          <span className="text-emerald-500 bg-emerald-500/10 px-2.5 py-0.5 rounded-lg border border-emerald-500/20">Expedição</span>
          <ArrowRight className="w-3 h-3" />
          <span>Concluído</span>
        </div>
      </div>

      {/* ── KPIs customizados para Expedição ────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border/60 p-4 rounded-2xl flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Aguardando Expedição</p>
            <p className="text-xl font-extrabold text-foreground mt-0.5">{kpis.waiting}</p>
          </div>
        </div>

        <div className="bg-card border border-border/60 p-4 rounded-2xl flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Em Conferência</p>
            <p className="text-xl font-extrabold text-foreground mt-0.5">{kpis.inProgress}</p>
          </div>
        </div>

        <div className="bg-card border border-border/60 p-4 rounded-2xl flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-500 shrink-0">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Cargas Bloqueadas</p>
            <p className="text-xl font-extrabold text-foreground mt-0.5">{kpis.blocked}</p>
          </div>
        </div>

        <div className="bg-card border border-border/60 p-4 rounded-2xl flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 shrink-0">
            <CheckCircle className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Liberadas Hoje</p>
            <p className="text-xl font-extrabold text-foreground mt-0.5">{kpis.releasedToday}</p>
          </div>
        </div>
      </div>

      {/* Selector de Abas do Chão de Fábrica */}
      <div className="flex gap-2 border-b border-border/40 pb-2">
        <Button
          variant={activeTab === 'covers' ? 'default' : 'ghost'}
          onClick={() => {
            setActiveTab('covers');
            setSelectedLotId(null);
            setSelectedCoverId(null);
            setActiveShipmentId(null);
          }}
          className="rounded-xl px-4 py-2 font-bold"
        >
          🗂 Capas de Cliente
        </Button>
        <Button
          variant={activeTab === 'lots' ? 'default' : 'ghost'}
          onClick={() => {
            setActiveTab('lots');
            setSelectedLotId(null);
            setSelectedCoverId(null);
            setActiveShipmentId(null);
          }}
          className="rounded-xl px-4 py-2 font-bold"
        >
          📦 Lotes Individuais
        </Button>
      </div>

      {/* ── Layout Operacional 3 Colunas ─────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        
        {/* Coluna 1: Lotes / Capas Prontas para Expedição */}
        <div className="xl:col-span-1 space-y-3">
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            {activeTab === 'covers' ? 'Capas Embaladas' : 'Lotes Embalados'}
          </h3>
          
          {activeTab === 'covers' ? (
            isLoadingCovers ? (
              <div className="text-center py-10 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                <p className="text-xs">Buscando capas...</p>
              </div>
            ) : readyCovers.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-border/40 rounded-2xl text-muted-foreground">
                <Package className="w-6 h-6 mx-auto mb-2 opacity-35" />
                <p className="text-xs">Nenhuma capa pronta para expedir</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
                {readyCovers.map(cover => {
                  const isSelected = selectedCoverId === cover.id;
                  return (
                    <button
                      key={cover.id}
                      onClick={() => {
                        setSelectedCoverId(cover.id);
                        setActiveShipmentId(null);
                      }}
                      className={cn(
                        'w-full text-left p-3.5 rounded-xl border transition-all flex flex-col justify-between space-y-2.5',
                        isSelected
                          ? 'border-emerald-500/50 bg-emerald-500/5 shadow-sm ring-1 ring-emerald-500/20'
                          : 'border-border/50 bg-card hover:border-border/80'
                      )}
                    >
                      <div className="flex justify-between items-start gap-2 w-full">
                        <div>
                          <span className="font-bold text-sm text-foreground">{cover.customer_name_exact}</span>
                          <p className="text-xs text-muted-foreground truncate max-w-[155px] mt-0.5 font-mono">
                            Capa: {cover.cover_code}
                          </p>
                        </div>
                        <Badge className={cn(
                          'text-[9px] font-bold px-1.5 py-0.5 rounded border-0',
                          cover.status === 'shipped' ? 'bg-emerald-500 text-white' : 'bg-blue-500 text-white'
                        )}>
                          {cover.status === 'shipped' ? 'Expedido' : 'Pronto'}
                        </Badge>
                      </div>
                      
                      <div className="text-[10px] text-muted-foreground flex justify-between items-center w-full">
                        <span>Lote Geral: {cover.general_lot_code}</span>
                        <span className="font-mono">{cover.total_lots} lotes</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          ) : (
            isLoadingLots ? (
              <div className="text-center py-10 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                <p className="text-xs">Buscando lotes prontos...</p>
              </div>
            ) : readyToShip.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-border/40 rounded-2xl text-muted-foreground">
                <Package className="w-6 h-6 mx-auto mb-2 opacity-35" />
                <p className="text-xs">Nenhum lote pronto para expedir</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
                {readyToShip.map(lot => {
                  const isSelected = selectedLotId === lot.id;
                  return (
                    <button
                      key={lot.id}
                      onClick={() => {
                        setSelectedLotId(lot.id);
                        setActiveShipmentId(null);
                      }}
                      className={cn(
                        'w-full text-left p-3.5 rounded-xl border transition-all flex flex-col justify-between space-y-2.5',
                        isSelected
                          ? 'border-emerald-500/50 bg-emerald-500/5 shadow-sm'
                          : 'border-border/50 bg-card hover:border-border/80'
                      )}
                    >
                      <div className="flex justify-between items-start gap-2 w-full">
                        <div>
                          <span className="font-bold text-sm text-foreground">{lot.lot_code}</span>
                          <p className="text-xs text-muted-foreground truncate max-w-[155px] mt-0.5">
                            {lot.production_orders?.customer_name || 'Geral'}
                          </p>
                        </div>
                        <Badge className={cn(
                          'text-[9px] font-bold px-1.5 py-0.5 rounded border-0',
                          lot.status === 'completed' ? 'bg-emerald-500 text-white' : 'bg-blue-500 text-white'
                        )}>
                          {lot.status === 'completed' ? 'Expedido' : 'Embalado'}
                        </Badge>
                      </div>
                      
                      <div className="text-[10px] text-muted-foreground flex justify-between items-center w-full">
                        <span>Prazo: {lot.deadline ? new Date(lot.deadline).toLocaleDateString('pt-BR') : 'Sem prazo'}</span>
                        <span className="font-mono">#ID: {lot.id.substring(0, 5)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          )}
        </div>

        {/* Coluna 2: Checklist de Carga & Scanner */}
        <div className="xl:col-span-2 space-y-4">
          {!(activeTab === 'covers' ? selectedCoverId : selectedLotId) ? (
            <div className="text-center py-24 border border-dashed border-border/40 bg-card/25 rounded-2xl text-muted-foreground flex flex-col items-center justify-center space-y-3">
              <Truck className="w-12 h-12 text-muted-foreground/30" />
              <div>
                <p className="font-bold text-foreground text-sm">Nenhuma carga selecionada</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-[280px]">
                  {activeTab === 'covers'
                    ? 'Selecione uma capa embalada na fila à esquerda para realizar o checklist de volumes e conferência de expedição.'
                    : 'Selecione um lote embalado na fila à esquerda para realizar o checklist de volumes e conferência de expedição.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-5">
              
              {/* Header do Lote/Carga */}
              <div className="flex justify-between items-start gap-4 pb-4 border-b border-border/40">
                <div>
                  <h4 className="font-extrabold text-foreground text-lg">
                    {activeTab === 'covers' ? selectedCover?.cover_code : selectedLot?.lot_code}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Cliente: {activeTab === 'covers' ? selectedCover?.customer_name_exact : (selectedLot?.production_orders?.customer_name || 'Geral')}
                  </p>
                </div>
                
                {shipments.length === 0 && !showForm && (
                  <Button
                    onClick={() => setShowForm(true)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-9 rounded-xl gap-1.5"
                  >
                    <Plus className="w-4 h-4" /> Iniciar Expedição
                  </Button>
                )}
              </div>

              {/* Formulário de Criação de Checklist */}
              {showForm && (
                <form onSubmit={handleCreateShipment} className="bg-secondary/25 border p-4 rounded-xl space-y-3 animate-in slide-in-from-top-2">
                  <h5 className="text-xs font-bold text-foreground uppercase tracking-wider">Dados do Transporte ({activeTab === 'covers' ? 'Capa de Cliente' : 'Lote Produtivo'})</h5>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Transportadora</Label>
                      <Input
                        value={form.carrier}
                        onChange={e => setForm({...form, carrier: e.target.value})}
                        className="h-9 text-xs rounded-lg"
                        placeholder="Ex: Alfa Log"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Placa do Veículo</Label>
                      <Input
                        value={form.vehicle}
                        onChange={e => setForm({...form, vehicle: e.target.value})}
                        className="h-9 text-xs rounded-lg"
                        placeholder="Ex: ABC-1234"
                      />
                    </div>
                    <div className="space-y-1 col-span-2">
                      <Label className="text-[10px] text-muted-foreground">Nome do Motorista</Label>
                      <Input
                        value={form.driver}
                        onChange={e => setForm({...form, driver: e.target.value})}
                        className="h-9 text-xs rounded-lg"
                        placeholder="Nome Completo"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button size="sm" variant="ghost" className="text-xs h-8" onClick={() => setShowForm(false)}>
                      Cancelar
                    </Button>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8" type="submit">
                      Salvar e Iniciar
                    </Button>
                  </div>
                </form>
              )}

              {/* Informações da Expedição Ativa */}
              {activeShipment && (
                <div className="space-y-4">
                  
                  {/* Dados de Entrega */}
                  <div className="bg-secondary/20 border p-3.5 rounded-xl text-xs grid grid-cols-2 sm:grid-cols-4 gap-3 text-muted-foreground">
                    <div>
                      <span className="font-bold text-foreground block">Expedição</span>
                      <span className="font-mono">{activeShipment.shipment_code.substring(0, 15)}</span>
                    </div>
                    <div>
                      <span className="font-bold text-foreground block">Motorista</span>
                      <span>{activeShipment.driver || 'Não informado'}</span>
                    </div>
                    <div>
                      <span className="font-bold text-foreground block">Veículo</span>
                      <span className="uppercase">{activeShipment.vehicle || 'Não informado'}</span>
                    </div>
                    <div>
                      <span className="font-bold text-foreground block">Status</span>
                      <Badge variant={activeShipment.status === 'shipped' ? 'default' : 'outline'} className="text-[9px] h-4 mt-0.5">
                        {activeShipment.status === 'shipped' ? 'Expedido' : 'Conferindo'}
                      </Badge>
                    </div>
                  </div>

                  {/* Progresso de Conferência */}
                  {progress && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-muted-foreground font-semibold">
                        <span>Volumes Conferidos: {progress.scanned} / {progress.total}</span>
                        <span className="text-emerald-500 font-bold">{progress.percent}%</span>
                      </div>
                      <div className="w-full bg-secondary h-2.5 rounded-full overflow-hidden">
                        <div
                          className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${progress.percent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Campo de Scanner do Volume */}
                  {activeShipment.status === 'pending' && (
                    <div className="space-y-3">
                      <form onSubmit={handleScanSubmit} className="flex gap-2">
                        <div className="relative flex-1">
                          <QrCode className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground animate-pulse" />
                          <Input
                            ref={scannerInputRef}
                            placeholder="BIPAR ETIQUETA DO VOLUME (Ex: VOL-15479-V1)..."
                            value={barcodeInput}
                            onChange={(e) => setBarcodeInput(e.target.value)}
                            className="pl-9 h-9 text-xs font-mono uppercase bg-secondary/30 border-border/60 focus:border-[#76FB91]/60 focus:ring-1 focus:ring-[#76FB91]/20 rounded-xl"
                            disabled={isScanning}
                            autoFocus
                          />
                        </div>
                        <Button
                          type="submit"
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white h-9 px-4 rounded-xl font-bold"
                          disabled={isScanning || !barcodeInput.trim()}
                        >
                          {isScanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        </Button>
                      </form>

                      {/* Feedback visual de bip */}
                      {scanFeedback && (
                        <div className={cn(
                          'p-3 rounded-xl border text-xs font-medium flex items-start gap-2.5 animate-in fade-in slide-in-from-bottom-2',
                          scanFeedback.type === 'success'
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                            : 'bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-400'
                        )}>
                          {scanFeedback.type === 'success' ? (
                            <CheckCircle className="w-4.5 h-4.5 text-emerald-500 shrink-0 mt-0.5" />
                          ) : (
                            <AlertCircle className="w-4.5 h-4.5 text-rose-500 shrink-0 mt-0.5" />
                          )}
                          <div className="space-y-0.5">
                            <p className="font-bold">{scanFeedback.type === 'success' ? '✔ Volume Conferido' : '✖ Divergência Detectada'}</p>
                            <p className="text-[10px] opacity-80 font-normal">{scanFeedback.message}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Lista de Conferência do Checklist de Carga */}
                  <div className="space-y-2 pt-2">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Lista de Conferência da Carga</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[25vh] overflow-y-auto pr-1">
                      {volumes.map(v => {
                        const isConferido = v.status === 'scanned';
                        return (
                          <div
                            key={v.id}
                            className={cn(
                              'p-2.5 rounded-xl border text-xs flex justify-between items-center gap-2',
                              isConferido
                                ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-semibold'
                                : 'bg-card border-border/50 text-foreground'
                            )}
                          >
                            <div className="truncate">
                              <span className="font-bold">Vol. {v.volume_code?.split('-V')[1] || v.id.substring(0, 5)}</span>
                              <span className="text-[10px] text-muted-foreground block font-mono">{v.volume_code}</span>
                            </div>
                            <Badge className={cn(
                              'text-[9px] font-bold px-1.5 py-0.5 rounded border-0',
                              isConferido ? 'bg-emerald-500 text-white' : 'bg-secondary text-foreground'
                            )}>
                              {isConferido ? '✔ Conferido' : '⚠ Pendente'}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Ação Principal: Liberar Carga */}
                  {progress && (
                    <div className="pt-4 border-t border-border/40 flex justify-between items-center gap-3">
                      <div className="text-xs text-muted-foreground">
                        {progress.percent === 100 ? (
                          <span className="text-emerald-500 font-bold">✔ Carga completa e verificada. Liberação autorizada.</span>
                        ) : (
                          <span className="text-rose-500 font-bold">⚠ Carga incompleta. Faltando {progress.total - progress.scanned} volumes.</span>
                        )}
                      </div>
                      
                      <Button
                        onClick={handleReleaseShipment}
                        disabled={progress.percent < 100 || activeShipment.status === 'shipped'}
                        className={cn(
                          'gap-2 rounded-xl h-10 font-bold px-5 text-white',
                          progress.percent === 100
                            ? 'bg-emerald-600 hover:bg-emerald-700 animate-bounce'
                            : 'bg-secondary text-muted-foreground cursor-not-allowed border border-border/60 hover:bg-secondary'
                        )}
                      >
                        <Check className="w-4.5 h-4.5" /> Liberar Carga
                      </Button>
                    </div>
                  )}

                </div>
              )}

            </div>
          )}
        </div>

        {/* Coluna 3: Faltantes / Divergências */}
        <div className="xl:col-span-1 bg-card border border-border/60 rounded-2xl p-4 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Volumes Faltantes</h3>
            <Badge variant="destructive" className="text-[10px] bg-rose-500/10 text-rose-500 font-bold">
              {missingVolumes.length}
            </Badge>
          </div>

          {!(activeTab === 'covers' ? selectedCoverId : selectedLotId) ? (
            <p className="text-xs text-muted-foreground italic text-center py-6">
              Selecione uma carga para verificar os faltantes.
            </p>
          ) : missingVolumes.length === 0 ? (
            <div className="text-center py-10 text-emerald-500 bg-emerald-500/5 border border-emerald-500/20 rounded-xl space-y-2">
              <CheckCircle className="w-8 h-8 mx-auto opacity-75" />
              <p className="text-xs font-bold">Carga 100% Conferida!</p>
              <p className="text-[10px] text-muted-foreground">Pronto para despacho físico.</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1">
              {missingVolumes.map(v => (
                <div
                  key={v.id}
                  className="p-3 bg-rose-500/5 border border-rose-500/15 text-rose-700 dark:text-rose-400 rounded-xl text-xs space-y-1 animate-in fade-in"
                >
                  <div className="flex justify-between items-start">
                    <span className="font-bold">Vol. {v.volume_code?.split('-V')[1] || v.id.substring(0, 5)}</span>
                    <Badge variant="outline" className="text-[9px] border-rose-200 text-rose-600 bg-rose-50">Falta</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground font-mono">{v.volume_code}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
