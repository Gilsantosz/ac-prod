import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import PageHeader from '@/components/ui/PageHeader';
import {
  Box, Plus, CheckCircle, RefreshCw, Package, ArrowRight,
  Lock, Unlock, Trash2, QrCode, Play, AlertCircle, Search, Layers, Truck
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  createVolume,
  scanPieceToVolume,
  removePieceFromVolume,
  closeVolume,
  reopenVolumeWithPermission,
  getVolumeItems,
  getPackingProgress
} from '@/lib/packingService';
import { getCustomerCovers, createCoverVolume, getCustomerCoverDetails } from '@/lib/customerCoverService';

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

export default function PackagingPage() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('covers'); // 'covers' | 'lots'
  const [selectedOrderId, setSelectedOrderId] = useState(null); // Used for lot mode
  const [selectedCoverId, setSelectedCoverId] = useState(null); // Used for cover mode
  const [activeVolumeId, setActiveVolumeId] = useState(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isSubmittingScan, setIsSubmittingScan] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [scanFeedback, setScanFeedback] = useState(null);
  const scannerInputRef = useRef(null);

  // 1. Query: Lotes individuais (Legado)
  const { data: lots = [], isLoading: isLoadingLots, refetch: refetchLots } = useQuery({
    queryKey: ['mes-packaging-lots'],
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

  const readyOrders = lots.filter(l =>
    l.status === 'waiting_packaging' || l.status === 'in_progress' || l.status === 'ready_to_pack' || l.status === 'packed'
  );

  // 2. Query: Capas de cliente
  const { data: covers = [], isLoading: isLoadingCovers, refetch: refetchCovers } = useQuery({
    queryKey: ['mes-packaging-covers'],
    queryFn: () => getCustomerCovers(),
  });

  const activeCovers = covers.filter(c => c.status !== 'shipped' && c.status !== 'cancelled');

  // 3. Query: Detalhes da capa selecionada
  const { data: selectedCover } = useQuery({
    queryKey: ['cover-details', selectedCoverId],
    queryFn: () => getCustomerCoverDetails(selectedCoverId),
    enabled: activeTab === 'covers' && !!selectedCoverId,
  });

  // 4. Query principal de progresso (Capa ou Lote)
  const targetProgressId = activeTab === 'covers' ? selectedCoverId : selectedOrderId;
  const { data: progressData, isLoading: isLoadingProgress, refetch: refetchProgress } = useQuery({
    queryKey: ['packing-progress', targetProgressId, activeTab],
    queryFn: () => getPackingProgress(targetProgressId, activeTab === 'covers'),
    enabled: !!targetProgressId,
  });

  const selectedLot = activeTab === 'lots' ? lots.find(l => l.id === selectedOrderId) : null;
  const activeVolume = progressData?.volumes?.find(v => v.id === activeVolumeId);

  // 5. Query: Peças do volume selecionado
  const { data: activeVolumeItems = [], refetch: refetchItems } = useQuery({
    queryKey: ['packing-volume-items', activeVolumeId],
    queryFn: () => getVolumeItems(activeVolumeId),
    enabled: !!activeVolumeId,
    initialData: [],
  });

  // 6. Query: Peças da capa/lote para o checklist na coluna 3
  const { data: checklistPieces = [], isLoading: isLoadingChecklist } = useQuery({
    queryKey: ['checklist-pieces', targetProgressId, activeTab],
    queryFn: async () => {
      if (activeTab === 'covers') {
        if (!selectedCoverId) return [];
        const { data: coverLots } = await supabase
          .from('production_lots')
          .select('id')
          .eq('customer_cover_id', selectedCoverId);
        const lotIds = coverLots?.map(l => l.id) || [];
        if (lotIds.length === 0) return [];
        
        const { data, error } = await supabase
          .from('production_pieces')
          .select('id, piece_name, piece_uid, status, current_stage, lot_id')
          .in('lot_id', lotIds);
        if (error) throw error;
        return data || [];
      } else {
        if (!selectedOrderId) return [];
        const { data, error } = await supabase
          .from('production_pieces')
          .select('id, piece_name, piece_uid, status, current_stage, lot_id')
          .eq('lot_id', selectedOrderId);
        if (error) throw error;
        return data || [];
      }
    },
    enabled: !!targetProgressId,
    initialData: []
  });

  // 7. Realtime KPIs
  const { data: realKpis } = useQuery({
    queryKey: ['mes-packaging-real-kpis'],
    queryFn: async () => {
      const { count: closedVolumesCount } = await supabase
        .from('packing_volumes')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'closed');

      const { data: completedPieces } = await supabase
        .from('production_pieces')
        .select('id')
        .eq('status', 'completed');
      
      const pieceIds = completedPieces?.map(p => p.id) || [];
      let packedCount = 0;
      if (pieceIds.length > 0) {
        const { count } = await supabase
          .from('packing_volume_items')
          .select('*', { count: 'exact', head: true })
          .in('piece_id', pieceIds);
        packedCount = count || 0;
      }
      
      const pendingCount = Math.max(0, pieceIds.length - packedCount);

      return {
        closedVolumes: closedVolumesCount || 0,
        pendingPieces: pendingCount || 0
      };
    },
    refetchInterval: 15000,
    initialData: { closedVolumes: 0, pendingPieces: 0 }
  });

  const kpis = {
    waiting: activeTab === 'covers' 
      ? activeCovers.filter(c => c.status === 'planned' || c.status === 'ready_to_pack').length
      : readyOrders.filter(l => l.status === 'waiting_packaging' || l.status === 'ready_to_pack').length,
    inProgress: activeTab === 'covers'
      ? activeCovers.filter(c => c.status === 'packing' || c.status === 'in_production').length
      : readyOrders.filter(l => l.status === 'in_progress').length,
    packed: activeTab === 'covers'
      ? activeCovers.filter(c => c.status === 'packed').length
      : readyOrders.filter(l => l.status === 'packed').length,
    totalVolumes: realKpis.closedVolumes,
    pendingPieces: realKpis.pendingPieces
  };

  useEffect(() => {
    if (progressData?.volumes && progressData.volumes.length > 0) {
      if (!activeVolumeId || !progressData.volumes.some(v => v.id === activeVolumeId)) {
        setActiveVolumeId(progressData.volumes[0].id);
      }
    } else {
      setActiveVolumeId(null);
    }
  }, [progressData, activeVolumeId]);

  useEffect(() => {
    if (activeVolume && activeVolume.status === 'open' && scannerInputRef.current) {
      scannerInputRef.current.focus();
    }
  }, [activeVolume, activeVolumeId, isSubmittingScan]);

  const handleCreateVolume = async () => {
    try {
      let vol;
      if (activeTab === 'covers') {
        if (!selectedCoverId) return;
        vol = await createCoverVolume(selectedCoverId);
      } else {
        if (!selectedLot) return;
        vol = await createVolume(selectedLot.id, selectedLot.production_orders?.id);
      }
      toast.success(`📦 Volume ${vol.volume_code} criado com sucesso!`);
      refetchProgress();
      setActiveVolumeId(vol.id);
      playBeep('success');
    } catch (e) {
      toast.error(e?.message || 'Falha ao criar volume');
      playBeep('error');
    }
  };

  const handleScanSubmit = async (e) => {
    e.preventDefault();
    if (!activeVolumeId || !barcodeInput.trim()) return;
    setIsSubmittingScan(true);
    setScanFeedback(null);
    try {
      const res = await scanPieceToVolume(activeVolumeId, barcodeInput);
      if (res.success) {
        toast.success(`peça bipada com sucesso!`);
        refetchItems();
        refetchProgress();
        setScanFeedback({ type: 'success', message: `Peça ${barcodeInput} adicionada ao volume.` });
        setBarcodeInput('');
        playBeep('success');
      } else {
        throw new Error(res.error);
      }
    } catch (err) {
      toast.error(err.message || 'Erro ao bipar peça');
      setScanFeedback({ type: 'error', message: err.message });
      playBeep('error');
    } finally {
      setIsSubmittingScan(false);
    }
  };

  const handleRemoveItem = async (itemId) => {
    try {
      await removePieceFromVolume(itemId);
      toast.success('Peça removida do volume.');
      refetchProgress();
      refetchItems();
      playBeep('success');
    } catch (e) {
      toast.error('Erro ao remover peça');
      playBeep('error');
    }
  };

  const handleReleaseToShipping = async () => {
    try {
      if (activeTab === 'covers') {
        if (!selectedCoverId) return;
        const { data: coverLots } = await supabase
          .from('production_lots')
          .select('id')
          .eq('customer_cover_id', selectedCoverId);
        const lotIds = coverLots?.map(l => l.id) || [];
        
        await supabase
          .from('customer_covers')
          .update({ status: 'packed', closed_at: new Date().toISOString() })
          .eq('id', selectedCoverId);

        for (const lId of lotIds) {
          await supabase.rpc('update_production_lot_status_safely', {
            p_lot_id: lId,
            p_new_status: 'packed'
          });
        }
        toast.success('🚀 Capa liberada para expedição com sucesso!');
        refetchCovers();
        refetchProgress();
      } else {
        if (!selectedOrderId) return;
        const { error } = await supabase
          .from('production_lots')
          .update({ status: 'packed' })
          .eq('id', selectedOrderId);
        if (error) throw error;
        toast.success('🚀 Lote liberado para expedição com sucesso!');
        refetchLots();
        refetchProgress();
      }
      playBeep('success');
    } catch (e) {
      toast.error('Erro ao liberar para expedição');
      playBeep('error');
    }
  };

  const handlePrintLabel = (volume) => {
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Etiqueta de Volume</title>
          <style>
            body { font-family: monospace; padding: 20px; text-align: center; }
            .barcode { font-size: 24px; font-weight: bold; margin: 20px 0; letter-spacing: 5px; }
            .meta { border-top: 1px dashed #000; padding-top: 10px; text-align: left; font-size: 12px; }
          </style>
        </head>
        <body>
          <h2>AC.Prod MES</h2>
          <h3>VOLUME DE EMBALAGEM</h3>
          <div class="barcode">${volume.volume_code}</div>
          <div class="meta">
            <p><strong>Carga / Lote Geral:</strong> ${selectedCover ? selectedCover.general_lot_code : selectedLot?.lot_code}</p>
            <p><strong>Destinatário:</strong> ${selectedCover ? selectedCover.customer_name_exact : selectedLot?.production_orders?.customer_name}</p>
            <p><strong>Status:</strong> ${volume.status === 'closed' ? 'FECHADO & LACRADO' : 'ABERTO'}</p>
            <p><strong>Data:</strong> ${new Date().toLocaleDateString('pt-BR')}</p>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  const filteredPieces = checklistPieces.filter(p =>
    p.piece_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.piece_uid.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      
      {/* ── Topo com Fluxo MES ──────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/60 pb-5">
        <PageHeader
          title="Embalagem (Scan-to-Pack)"
          subtitle="Agrupe lotes de clientes, crie volumes, bipa peças e libere para expedição."
          icon={Package}
        />
        
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground bg-secondary/30 p-2 rounded-xl border border-border/50">
          <span>PCP</span>
          <ArrowRight className="w-3 h-3" />
          <span>Produção</span>
          <ArrowRight className="w-3 h-3" />
          <span className="text-emerald-500 bg-emerald-500/10 px-2.5 py-0.5 rounded-lg border border-emerald-500/20">Embalagem</span>
          <ArrowRight className="w-3 h-3" />
          <span>Expedição</span>
          <ArrowRight className="w-3 h-3" />
          <span>Concluído</span>
        </div>
      </div>

      {/* ── KPIs customizados para Embalagem ─────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-card border border-border/60 p-4 rounded-2xl flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Aguardando Embalagem</p>
            <p className="text-xl font-extrabold text-foreground mt-0.5">{kpis.waiting}</p>
          </div>
        </div>
        
        <div className="bg-card border border-border/60 p-4 rounded-2xl flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Em Embalagem</p>
            <p className="text-xl font-extrabold text-foreground mt-0.5">{kpis.inProgress}</p>
          </div>
        </div>
        
        <div className="bg-card border border-border/60 p-4 rounded-2xl flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-500 shrink-0">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Peças Pendentes</p>
            <p className="text-xl font-extrabold text-foreground mt-0.5">{kpis.pendingPieces}</p>
          </div>
        </div>
        
        <div className="bg-card border border-border/60 p-4 rounded-2xl flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 shrink-0">
            <Box className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Volumes Fechados</p>
            <p className="text-xl font-extrabold text-foreground mt-0.5">{kpis.totalVolumes}</p>
          </div>
        </div>
        
        <div className="bg-card border border-border/60 p-4 rounded-2xl flex items-center gap-3 col-span-2 md:col-span-1">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 shrink-0">
            <CheckCircle className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Prontos p/ Expedição</p>
            <p className="text-xl font-extrabold text-foreground mt-0.5">{kpis.packed}</p>
          </div>
        </div>
      </div>

      {/* Selector de Abas do Chão de Fábrica */}
      <div className="flex gap-2 border-b border-border/40 pb-2">
        <Button
          variant={activeTab === 'covers' ? 'default' : 'ghost'}
          onClick={() => {
            setActiveTab('covers');
            setSelectedOrderId(null);
            setActiveVolumeId(null);
          }}
          className="rounded-xl px-4 py-2 font-bold"
        >
          🗂 Capas de Cliente
        </Button>
        <Button
          variant={activeTab === 'lots' ? 'default' : 'ghost'}
          onClick={() => {
            setActiveTab('lots');
            setSelectedCoverId(null);
            setActiveVolumeId(null);
          }}
          className="rounded-xl px-4 py-2 font-bold"
        >
          📦 Lotes Individuais
        </Button>
      </div>

      {/* ── Layout Operacional 3 Colunas ─────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        
        {/* Coluna 1: Fila de Lotes / Capas */}
        <div className="xl:col-span-1 space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              {activeTab === 'covers' ? 'Capas Ativas' : 'Fila de Lotes'}
            </h3>
            <Badge variant="outline" className="text-[10px] bg-secondary/20">
              {activeTab === 'covers' ? activeCovers.length : readyOrders.length}
            </Badge>
          </div>

          {activeTab === 'covers' ? (
            isLoadingCovers ? (
              <div className="text-center py-10 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                <p className="text-xs">Carregando capas...</p>
              </div>
            ) : activeCovers.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-border/40 rounded-2xl text-muted-foreground">
                <Package className="w-6 h-6 mx-auto mb-2 opacity-35" />
                <p className="text-xs">Nenhuma capa pendente</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
                {activeCovers.map(cover => {
                  const isSelected = selectedCoverId === cover.id;
                  return (
                    <div
                      key={cover.id}
                      className={cn(
                        'p-3.5 rounded-xl border transition-all duration-200 flex flex-col justify-between space-y-2.5',
                        isSelected
                          ? 'border-emerald-500/50 bg-emerald-500/5 shadow-sm ring-1 ring-emerald-500/20'
                          : 'border-border/50 bg-card hover:border-border/80'
                      )}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <span className="font-bold text-sm text-foreground">{cover.customer_name_exact}</span>
                          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{cover.cover_code}</p>
                        </div>
                        <Badge className="text-[9px] bg-secondary text-foreground border-0">
                          {cover.total_lots} lotes
                        </Badge>
                      </div>

                      <div className="text-[10px] text-muted-foreground">
                        Lote Geral: <strong>{cover.general_lot_code}</strong>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelectedCoverId(cover.id);
                            setActiveVolumeId(null);
                          }}
                          className={cn(
                            'w-full text-xs font-semibold h-8 rounded-lg',
                            isSelected
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                              : 'bg-secondary hover:bg-secondary/80 text-foreground'
                          )}
                        >
                          {isSelected ? 'Capa Ativa' : 'Abrir Capa'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            isLoadingLots ? (
              <div className="text-center py-10 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                <p className="text-xs">Carregando fila de lotes...</p>
              </div>
            ) : readyOrders.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-border/40 rounded-2xl text-muted-foreground">
                <Package className="w-6 h-6 mx-auto mb-2 opacity-35" />
                <p className="text-xs">Nenhum lote pendente</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
                {readyOrders.map(lot => {
                  const isSelected = selectedOrderId === lot.id;
                  const clientName = lot.production_orders?.customer_name || 'Móvel Planejado';
                  const isLate = new Date(lot.deadline) < new Date() && lot.status !== 'packed';
                  
                  return (
                    <div
                      key={lot.id}
                      className={cn(
                        'p-3.5 rounded-xl border transition-all duration-200 flex flex-col justify-between space-y-2.5',
                        isSelected
                          ? 'border-emerald-500/50 bg-emerald-500/5 shadow-sm ring-1 ring-emerald-500/20'
                          : 'border-border/50 bg-card hover:border-border/80'
                      )}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-sm text-foreground">{lot.lot_code}</span>
                            {isLate && (
                              <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" title="Lote em atraso!" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[150px]">{clientName}</p>
                        </div>
                        <Badge className={cn(
                          'text-[9px] font-bold px-1.5 py-0.5 rounded border-0',
                          lot.status === 'packed' ? 'bg-emerald-500 text-white' :
                          lot.status === 'in_progress' ? 'bg-amber-500 text-white animate-pulse' :
                          'bg-blue-500 text-white'
                        )}>
                          {lot.status === 'packed' ? 'Embalado' :
                           lot.status === 'in_progress' ? 'Em Embalagem' : 'Aguardando'}
                        </Badge>
                      </div>

                      <div className="text-[10px] text-muted-foreground flex justify-between items-center gap-2">
                        <span>Prazo: {lot.deadline ? new Date(lot.deadline).toLocaleDateString('pt-BR') : 'Sem prazo'}</span>
                        <span className="font-mono">Pedido: #{lot.production_orders?.order_code || lot.order_id || 'N/A'}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelectedOrderId(lot.id);
                            setActiveVolumeId(null);
                          }}
                          className={cn(
                            'w-full text-xs font-semibold h-8 rounded-lg',
                            isSelected
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                              : 'bg-secondary hover:bg-secondary/80 text-foreground'
                          )}
                        >
                          {isSelected ? 'Lote Ativo' : 'Abrir Lote'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>

        {/* Coluna 2: Operação de Volume & Scanner */}
        <div className="xl:col-span-2 space-y-4">
          {!targetProgressId ? (
            <div className="text-center py-24 border border-dashed border-border/40 bg-card/25 rounded-2xl text-muted-foreground flex flex-col items-center justify-center space-y-3">
              <Package className="w-12 h-12 text-muted-foreground/30" />
              <div>
                <p className="font-bold text-foreground text-sm">
                  {activeTab === 'covers' ? 'Nenhuma capa selecionada' : 'Nenhum lote selecionado'}
                </p>
                <p className="text-xs text-muted-foreground mt-1 max-w-[280px] mx-auto">
                  {activeTab === 'covers' ? 'Abra uma capa de cliente na lista ao lado para iniciar.' : 'Abra um lote individual na lista ao lado para iniciar.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              
              {/* Header do lote / capa ativo */}
              <div className="bg-card border border-border/60 rounded-2xl p-4.5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Destinatário</span>
                    <Badge variant="outline" className="text-[9px] bg-secondary/35 text-foreground py-0.5">
                      {activeTab === 'covers' ? 'Capa Multi-Lote' : 'Lote Único'}
                    </Badge>
                  </div>
                  <h2 className="font-extrabold text-foreground text-lg mt-0.5">
                    {activeTab === 'covers' ? selectedCover?.customer_name_exact : selectedLot?.production_orders?.customer_name}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                    ID Interno: {activeTab === 'covers' ? selectedCover?.cover_code : selectedLot?.lot_code}
                  </p>
                </div>

                <div className="flex items-center gap-2.5">
                  <div className="text-right">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block">Progresso Embalagem</span>
                    <strong className="text-foreground text-base tabular-nums">{progressData?.percent || 0}%</strong>
                  </div>
                  <Button
                    onClick={handleCreateVolume}
                    className="bg-[#2d9c4a] hover:bg-[#25813d] text-white rounded-xl h-10 font-bold px-4 gap-1.5"
                  >
                    <Plus className="w-4.5 h-4.5" /> Criar Volume
                  </Button>
                </div>
              </div>

              {/* Exibir Lotes Separados e Progresso (Somente em Modo Capa) */}
              {activeTab === 'covers' && selectedCover?.lots && (
                <div className="bg-card border border-border/40 rounded-2xl p-4 space-y-3">
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" /> Lotes integrados nesta capa
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {selectedCover.lots.map(lot => (
                      <div key={lot.id} className="p-3 rounded-xl bg-secondary/30 border border-border/40 flex flex-col justify-between space-y-1.5">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-xs text-foreground">{lot.lot_code}</span>
                          <Badge className="text-[9px] bg-[#2d9c4a]/10 text-[#2d9c4a] border-0">{lot.status}</Badge>
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span>Peças: {lot.planned_quantity}</span>
                          <span>Faltam: {lot.pending_quantity}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Seção de Volumes Ativos */}
              {isLoadingProgress ? (
                <div className="flex items-center gap-2.5 py-6 text-sm text-muted-foreground">
                  <RefreshCw className="w-4.5 h-4.5 animate-spin" /> Carregando volumes...
                </div>
              ) : progressData?.volumes?.length === 0 ? (
                <div className="text-center py-10 border border-dashed border-border/40 rounded-2xl text-muted-foreground bg-card/20">
                  <Box className="w-8 h-8 mx-auto mb-2 opacity-35" />
                  <p className="text-xs font-semibold">Nenhum volume aberto nesta capa</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Clique em "Criar Volume" para iniciar a bipagem.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  
                  {/* Fila de Volumes */}
                  <div className="md:col-span-1 space-y-1.5 max-h-[35vh] overflow-y-auto pr-1">
                    {progressData?.volumes?.map(v => (
                      <button
                        key={v.id}
                        onClick={() => {
                          setActiveVolumeId(v.id);
                          setScanFeedback(null);
                        }}
                        className={cn(
                          'w-full text-left p-2.5 rounded-xl border flex items-center justify-between transition-all duration-150',
                          activeVolumeId === v.id
                            ? 'border-emerald-500/50 bg-emerald-500/5 shadow-sm'
                            : 'border-border/50 bg-card hover:border-border/80'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Box className={cn('w-4 h-4', v.status === 'closed' ? 'text-emerald-500' : 'text-muted-foreground')} />
                          <span className="text-xs font-bold text-foreground">Vol. {v.volume_code.substring(v.volume_code.lastIndexOf('-V') + 2)}</span>
                        </div>
                        <Badge className={cn(
                          'text-[9px] px-1.5 py-0.5 rounded border-0',
                          v.status === 'closed' ? 'bg-emerald-500 text-white' : 'bg-secondary text-foreground'
                        )}>
                          {v.status === 'closed' ? 'Lacre' : 'Aberto'}
                        </Badge>
                      </button>
                    ))}
                  </div>

                  {/* Detalhe do Volume Selecionado */}
                  <div className="md:col-span-2 border border-border/60 bg-card rounded-2xl p-4 space-y-4 relative flex flex-col justify-between">
                    {activeVolume ? (
                      <>
                        <div className="flex justify-between items-start gap-2 flex-wrap pb-2 border-b border-border/40">
                          <div>
                            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider block">Volume Selecionado</span>
                            <span className="font-extrabold text-foreground text-sm">{activeVolume.volume_code}</span>
                          </div>
                          
                          <div className="flex gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-[10px] h-7 px-2.5 rounded-lg border-border/60"
                              onClick={() => handlePrintLabel(activeVolume)}
                            >
                              Imprimir
                            </Button>
                            {activeVolume.status === 'open' ? (
                              <Button
                                size="sm"
                                className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] h-7 px-2.5 rounded-lg gap-1"
                                onClick={() => closeVolume(activeVolume.id).then(() => { refetchProgress(); refetchItems(); })}
                              >
                                <Lock className="w-3 h-3" /> Fechar
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="destructive"
                                className="text-[10px] h-7 px-2.5 rounded-lg gap-1"
                                onClick={() => reopenVolumeWithPermission(activeVolume.id).then(() => { refetchProgress(); refetchItems(); })}
                              >
                                <Unlock className="w-3 h-3" /> Reabrir
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Scanner e Feedback */}
                        {activeVolume.status === 'open' ? (
                          <div className="space-y-3">
                            <form onSubmit={handleScanSubmit} className="flex gap-2">
                              <div className="relative flex-1">
                                <QrCode className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground animate-pulse" />
                                <Input
                                  ref={scannerInputRef}
                                  placeholder="BIPE O CÓDIGO DA PEÇA..."
                                  value={barcodeInput}
                                  onChange={(e) => setBarcodeInput(e.target.value)}
                                  className="pl-9 h-9 text-xs font-mono uppercase bg-secondary/25 border-border/60 focus:border-[#76FB91]/60 focus:ring-1 focus:ring-[#76FB91]/20 rounded-xl"
                                  disabled={isSubmittingScan}
                                  autoFocus
                                />
                              </div>
                              <Button
                                type="submit"
                                size="sm"
                                className="bg-emerald-600 hover:bg-emerald-700 text-white h-9 px-3.5 rounded-xl font-bold"
                                disabled={isSubmittingScan || !barcodeInput.trim()}
                              >
                                {isSubmittingScan ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                              </Button>
                            </form>

                            {scanFeedback && (
                              <div className={cn(
                                'p-3 rounded-xl border text-xs font-medium flex items-start gap-2.5 transition-all duration-200 animate-in fade-in slide-in-from-bottom-2',
                                scanFeedback.type === 'success'
                                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                                  : 'bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-400'
                              )}>
                                <div className="space-y-0.5">
                                  <p className="font-bold">{scanFeedback.type === 'success' ? '✔ Leitura Confirmada' : '✖ Erro de Validação'}</p>
                                  <p className="text-[10px] opacity-80 leading-relaxed font-normal">{scanFeedback.message}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="bg-emerald-500/5 border border-emerald-500/20 text-emerald-600 rounded-xl p-3 flex items-center gap-2 text-xs">
                            <CheckCircle className="w-4.5 h-4.5 shrink-0" />
                            <span>Volume selado.</span>
                          </div>
                        )}

                        {/* Relação de Peças Embaladas neste Volume */}
                        <div className="space-y-2">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Itens no Volume ({activeVolumeItems.length})</span>
                          {activeVolumeItems.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground italic">Nenhuma peça embalada neste volume.</p>
                          ) : (
                            <div className="space-y-1 max-h-[15vh] overflow-y-auto pr-1">
                              {activeVolumeItems.map(item => (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between gap-2 p-2 bg-secondary/35 hover:bg-secondary/65 rounded-lg text-xs"
                                >
                                  <p className="font-bold text-foreground truncate">{item.production_pieces?.piece_name}</p>
                                  {activeVolume.status === 'open' && (
                                    <button onClick={() => handleRemoveItem(item.id)} className="text-muted-foreground hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="text-center py-10 text-muted-foreground">
                        <Box className="w-6 h-6 mx-auto mb-2 opacity-30" />
                        <p className="text-xs font-semibold">Selecione ou crie um volume</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Botão de Liberação Completa */}
              {progressData && (
                <div className="pt-2 border-t border-border/40 flex justify-between items-center gap-3 flex-wrap">
                  <div className="text-xs text-muted-foreground">
                    {progressData.percent === 100 ? (
                      <span className="text-emerald-500 font-bold">✔ Capa totalmente embalada. Pronto para liberação.</span>
                    ) : (
                      <span>Ainda faltam {progressData.totalExpected - progressData.totalPacked} peças para finalizar a embalagem.</span>
                    )}
                  </div>
                  
                  <Button
                    onClick={handleReleaseToShipping}
                    disabled={progressData.percent < 100}
                    className={cn(
                      'gap-2 rounded-xl h-10 font-bold px-5 text-white',
                      progressData.percent === 100
                        ? 'bg-emerald-600 hover:bg-emerald-700 animate-bounce'
                        : 'bg-secondary text-muted-foreground cursor-not-allowed border border-border/60 hover:bg-secondary'
                    )}
                  >
                    <Truck className="w-4.5 h-4.5" /> Liberar para Expedição
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Coluna 3: Checklist de Peças */}
        <div className="xl:col-span-1 bg-card border border-border/60 rounded-2xl p-4 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Relação de Peças</h3>
            <Badge variant="outline" className="text-[10px] bg-secondary/20">{filteredPieces.length}</Badge>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar peça..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-xs rounded-xl"
            />
          </div>

          {!targetProgressId ? (
            <div className="text-center py-10 text-muted-foreground text-xs italic">
              {activeTab === 'covers' ? 'Selecione uma capa para carregar as peças.' : 'Selecione um lote para carregar as peças.'}
            </div>
          ) : isLoadingChecklist ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-primary" />
              <span className="text-xs">Carregando checklist...</span>
            </div>
          ) : filteredPieces.length === 0 ? (
            <p className="text-xs text-muted-foreground italic text-center py-6">Nenhuma peça encontrada.</p>
          ) : (
            <div className="space-y-1.5 max-h-[55vh] overflow-y-auto pr-1">
              {filteredPieces.map(piece => {
                const isPacked = piece.status === 'packed' || piece.current_stage === 'Embalagem';
                const isRework = piece.status === 'rework' || piece.current_stage === 'Marcenaria';
                
                return (
                  <div
                    key={piece.id}
                    className={cn(
                      'p-2.5 rounded-lg border text-xs flex justify-between items-center gap-2 transition-all duration-150',
                      isPacked ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-700' :
                      isRework ? 'bg-purple-500/5 border-purple-500/20 text-purple-700' :
                      'bg-card border-border/50 text-foreground'
                    )}
                  >
                    <div className="truncate">
                      <p className="font-bold truncate">{piece.piece_name}</p>
                      <p className="text-[9px] font-mono text-muted-foreground">{piece.piece_uid}</p>
                    </div>
                    
                    <Badge className={cn(
                      'text-[9px] font-bold px-1.5 py-0.5 rounded border-0 shrink-0',
                      isPacked ? 'bg-emerald-500 text-white' :
                      isRework ? 'bg-purple-500 text-white' :
                      'bg-amber-500 text-white'
                    )}>
                      {isPacked ? '✔ Embalada' :
                       isRework ? '🔁 Retrabalho' : '⚠ Pendente'}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
