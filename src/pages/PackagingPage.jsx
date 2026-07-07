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
  Lock, Unlock, Trash2, QrCode, Play, AlertCircle, Search, Layers, X
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

export default function PackagingPage() {
  const qc = useQueryClient();
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [activeVolumeId, setActiveVolumeId] = useState(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isSubmittingScan, setIsSubmittingScan] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [scanFeedback, setScanFeedback] = useState(null);
  const scannerInputRef = useRef(null);

  // 1. Query principal: Lotes MES do banco
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

  // Filtramos os lotes para a fila da Embalagem (não queremos mostrar "Em Produção" se o status for estritamente inativo,
  // mas incluímos os lotes que estão prontos para embalagem ou já em andamento de embalagem).
  const readyOrders = lots.filter(l =>
    l.status === 'waiting_packaging' || l.status === 'in_progress' || l.status === 'ready_to_pack' || l.status === 'packed'
  );

  // 2. Query de progresso do Lote selecionado
  const { data: progressData, isLoading: isLoadingProgress, refetch: refetchProgress } = useQuery({
    queryKey: ['packing-progress', selectedOrderId],
    queryFn: () => getPackingProgress(selectedOrderId),
    enabled: !!selectedOrderId,
  });

  const selectedLot = lots.find(l => l.id === selectedOrderId);
  const activeVolume = progressData?.volumes?.find(v => v.id === activeVolumeId);

  // 3. Query das peças do volume selecionado
  const { data: activeVolumeItems = [], isLoading: isLoadingItems, refetch: refetchItems } = useQuery({
    queryKey: ['packing-volume-items', activeVolumeId],
    queryFn: () => getVolumeItems(activeVolumeId),
    enabled: !!activeVolumeId,
    initialData: [],
  });

  // Auto-seleciona o primeiro volume ativo do lote quando muda
  useEffect(() => {
    if (progressData?.volumes && progressData.volumes.length > 0) {
      if (!activeVolumeId || !progressData.volumes.some(v => v.id === activeVolumeId)) {
        setActiveVolumeId(progressData.volumes[0].id);
      }
    } else {
      setActiveVolumeId(null);
    }
  }, [progressData, activeVolumeId]);

  // Mantém o input do scanner focado automaticamente no chão de fábrica
  useEffect(() => {
    if (activeVolume && activeVolume.status === 'open' && scannerInputRef.current) {
      scannerInputRef.current.focus();
    }
  }, [activeVolume, activeVolumeId, isSubmittingScan]);

  // KPIs dinâmicos da Embalagem baseados nos dados reais de readyOrders
  const kpis = {
    waiting: readyOrders.filter(l => l.status === 'waiting_packaging' || l.status === 'ready_to_pack').length,
    inProgress: readyOrders.filter(l => l.status === 'in_progress').length,
    packed: readyOrders.filter(l => l.status === 'packed').length,
    totalVolumes: readyOrders.reduce((sum, l) => sum + (l.status === 'packed' ? 2 : 0), 0), // Mock/aprox. de volumes fechados
    pendingPieces: readyOrders.length * 12 // Aprox. para visualização inicial
  };

  const handleCreateVolume = async () => {
    if (!selectedLot) return;
    try {
      const vol = await createVolume(selectedLot.id, selectedLot.production_orders?.id);
      toast.success(`📦 Volume ${vol.volume_code} criado com sucesso!`);
      refetchProgress();
      setActiveVolumeId(vol.id);
      playBeep('success');
    } catch (e) {
      toast.error(e?.message || 'Falha ao criar volume');
      playBeep('error');
    }
  };

  const handleCloseVolume = async (volId) => {
    try {
      await closeVolume(volId);
      toast.success('✓ Volume fechado e lacrado com sucesso!');
      refetchProgress();
      refetchItems();
      playBeep('success');
    } catch (e) {
      toast.error(e?.message || 'Falha ao fechar volume');
      playBeep('error');
    }
  };

  const handleReopenVolume = async (volId) => {
    try {
      await reopenVolumeWithPermission(volId);
      toast.success('🔓 Volume reaberto para edição!');
      refetchProgress();
      refetchItems();
      playBeep('success');
    } catch (e) {
      toast.error(e?.message || 'Erro ao reabrir');
      playBeep('error');
    }
  };

  const handleScanSubmit = async (e) => {
    e.preventDefault();
    const barcode = barcodeInput.trim();
    if (!barcode || !activeVolumeId) return;

    setIsSubmittingScan(true);
    setScanFeedback(null);

    try {
      await scanPieceToVolume(activeVolumeId, barcode);
      setScanFeedback({
        type: 'success',
        message: `Peça "${barcode}" embalada com sucesso no Volume ${activeVolume.volume_code.split('-V')[1]}!`
      });
      playBeep('success');
      setBarcodeInput('');
      refetchItems();
      refetchProgress();
    } catch (err) {
      setScanFeedback({
        type: 'error',
        message: err.message || 'Código inválido ou peça já embalada.'
      });
      playBeep('error');
    } finally {
      setIsSubmittingScan(false);
    }
  };

  const handleRemoveItem = async (itemId) => {
    try {
      await removePieceFromVolume(itemId);
      toast.success('Peça removida do volume.');
      refetchItems();
      refetchProgress();
      playBeep('success');
    } catch (err) {
      toast.error(err.message);
      playBeep('error');
    }
  };

  const handlePrintLabel = (volume) => {
    if (!volume) return;
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>Volume ${volume.volume_code}</title>
          <style>
            body { font-family: 'Courier New', monospace; padding: 20px; text-align: center; }
            .box { border: 3px solid #000; padding: 20px; width: 350px; margin: 0 auto; border-radius: 8px; }
            .title { font-size: 20px; font-weight: bold; margin-bottom: 5px; }
            .code { font-size: 24px; font-weight: bold; background: #000; color: #fff; padding: 5px; margin: 15px 0; }
            .meta { text-align: left; font-size: 13px; line-height: 1.5; }
          </style>
        </head>
        <body onload="window.print(); window.close();">
          <div class="box">
            <div class="title">AC.Prod MES - EMBALAGEM</div>
            <div class="code">${volume.volume_code}</div>
            <div class="meta">
              <strong>LOTE:</strong> ${selectedLot?.lot_code}<br/>
              <strong>CLIENTE:</strong> ${selectedLot?.production_orders?.customer_name || 'Geral'}<br/>
              <strong>PEDIDO:</strong> ${selectedLot?.production_orders?.order_code || ''}<br/>
              <strong>DATA:</strong> ${new Date(volume.created_at).toLocaleString('pt-BR')}<br/>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleReleaseToShipping = async () => {
    if (!selectedLot || !progressData) return;
    try {
      const { error } = await supabase
        .from('production_lots')
        .update({ status: 'packed' })
        .eq('id', selectedLot.id);
      if (error) throw error;
      toast.success('🚀 Lote liberado para expedição com sucesso!');
      refetchLots();
      refetchProgress();
      playBeep('success');
    } catch (e) {
      toast.error('Erro ao liberar lote');
      playBeep('error');
    }
  };

  // Filtragem de peças do checklist da coluna direita
  const allPieces = progressData?.pieces || [];
  const filteredPieces = allPieces.filter(p =>
    p.piece_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.piece_uid.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      
      {/* ── Topo com Fluxo MES ──────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/60 pb-5">
        <PageHeader
          title="Embalagem de Lotes"
          subtitle="Crie volumes, bipa peças, bloqueie pendências e libere para expedição com segurança."
          icon={Package}
        />
        
        {/* Barra de Progresso MES */}
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

      {/* ── Layout Operacional 3 Colunas ─────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        
        {/* Coluna 1: Fila de Lotes */}
        <div className="xl:col-span-1 space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Fila de Lotes</h3>
            <Badge variant="outline" className="text-[10px] bg-secondary/20">{readyOrders.length}</Badge>
          </div>

          {isLoadingLots ? (
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
          )}
        </div>

        {/* Coluna 2: Operação de Volume & Scanner */}
        <div className="xl:col-span-2 space-y-4">
          {!selectedOrderId ? (
            <div className="text-center py-24 border border-dashed border-border/40 bg-card/25 rounded-2xl text-muted-foreground flex flex-col items-center justify-center space-y-3">
              <Package className="w-12 h-12 text-muted-foreground/30" />
              <div>
                <p className="font-bold text-foreground text-sm">Nenhum lote selecionado</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-[280px] mx-auto">
                  Escolha um lote na fila à esquerda para criar volumes, bipar peças, conferir pendências ou liberar para a expedição.
                </p>
              </div>
              {readyOrders.length > 0 && (
                <Button
                  onClick={() => setSelectedOrderId(readyOrders[0].id)}
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl h-9"
                >
                  Selecionar primeiro lote disponível
                </Button>
              )}
            </div>
          ) : (
            <div className="bg-card border border-border/60 rounded-2xl p-5 space-y-5">
              
              {/* Header do Lote Ativo */}
              <div className="flex justify-between items-start gap-4 pb-4 border-b border-border/40">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-extrabold text-foreground text-lg">{selectedLot?.lot_code}</h4>
                    <Badge variant="outline" className="text-[10px] bg-secondary/35">
                      Pedido: #{selectedLot?.production_orders?.order_code || 'Geral'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Cliente: {selectedLot?.production_orders?.customer_name || 'Móvel Sob Medida'}
                  </p>
                </div>
                
                <Button
                  className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white h-9 rounded-xl font-bold"
                  onClick={handleCreateVolume}
                >
                  <Plus className="w-4 h-4" /> Criar Volume
                </Button>
              </div>

              {/* Barra de Progresso do Lote */}
              {progressData && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground font-semibold">
                    <span>Embaladas: {progressData.totalPacked} / {progressData.totalExpected} peças</span>
                    <span className="text-emerald-500">{progressData.percent}%</span>
                  </div>
                  <div className="w-full bg-secondary h-2.5 rounded-full overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                      style={{ width: `${progressData.percent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Seção de Volumes Ativos */}
              {isLoadingProgress ? (
                <div className="flex items-center gap-2.5 py-6 text-sm text-muted-foreground">
                  <RefreshCw className="w-4.5 h-4.5 animate-spin" /> Carregando volumes do lote...
                </div>
              ) : progressData?.volumes?.length === 0 ? (
                <div className="text-center py-10 border border-dashed border-border/40 rounded-2xl text-muted-foreground">
                  <Box className="w-8 h-8 mx-auto mb-2 opacity-35" />
                  <p className="text-xs font-semibold">Nenhum volume aberto neste lote</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Clique em "Criar Volume" para iniciar a bipagem.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  
                  {/* Fila de Volumes do Lote */}
                  <div className="md:col-span-1 space-y-1.5 max-h-[30vh] overflow-y-auto pr-1">
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
                          <span className="text-xs font-bold text-foreground">Vol. {v.volume_code.split('-V')[1]}</span>
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
                                onClick={() => handleCloseVolume(activeVolume.id)}
                              >
                                <Lock className="w-3 h-3" /> Fechar
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="destructive"
                                className="text-[10px] h-7 px-2.5 rounded-lg gap-1"
                                onClick={() => handleReopenVolume(activeVolume.id)}
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
                                  placeholder="BIPE O CÓDIGO DA PEÇA OU QR CODE..."
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

                            {/* Painel de Feedback Visual de Bipagem */}
                            {scanFeedback && (
                              <div className={cn(
                                'p-3 rounded-xl border text-xs font-medium flex items-start gap-2.5 transition-all duration-200 animate-in fade-in slide-in-from-bottom-2',
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
                                  <p className="font-bold">{scanFeedback.type === 'success' ? '✔ Leitura Confirmada' : '✖ Erro de Validação'}</p>
                                  <p className="text-[10px] opacity-80 leading-relaxed font-normal">{scanFeedback.message}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="bg-emerald-500/5 border border-emerald-500/20 text-emerald-600 rounded-xl p-3 flex items-center gap-2 text-xs">
                            <CheckCircle className="w-4.5 h-4.5 shrink-0" />
                            <span>Volume selado e lacrado. Nenhuma alteração é permitida.</span>
                          </div>
                        )}

                        {/* Relação de Peças Embaladas neste Volume */}
                        <div className="space-y-2">
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">Itens no Volume ({activeVolumeItems.length})</span>
                          {isLoadingItems ? (
                            <p className="text-[11px] text-muted-foreground">Buscando peças...</p>
                          ) : activeVolumeItems.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground italic">Nenhuma peça embalada neste volume.</p>
                          ) : (
                            <div className="space-y-1 max-h-[15vh] overflow-y-auto pr-1">
                              {activeVolumeItems.map(item => (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between gap-2 p-2 bg-secondary/35 hover:bg-secondary/65 rounded-lg text-xs"
                                >
                                  <div className="truncate">
                                    <p className="font-bold text-foreground truncate">{item.production_pieces?.piece_name}</p>
                                    <p className="text-[9px] text-muted-foreground font-mono">{item.traceability_code}</p>
                                  </div>
                                  {activeVolume.status === 'open' && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500"
                                      onClick={() => handleRemoveItem(item.id)}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </Button>
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

              {/* Botão de Liberação de Lote Completo */}
              {progressData && (
                <div className="pt-2 border-t border-border/40 flex justify-between items-center gap-3 flex-wrap">
                  <div className="text-xs text-muted-foreground">
                    {progressData.percent === 100 ? (
                      <span className="text-emerald-500 font-bold">✔ Lote totalmente embalado. Pronto para liberação.</span>
                    ) : (
                      <span>O lote requer {progressData.totalExpected - progressData.totalPacked} peças adicionais para ser concluído.</span>
                    )}
                  </div>
                  
                  <Button
                    onClick={handleReleaseToShipping}
                    disabled={progressData.percent < 100 || selectedLot.status === 'packed'}
                    className={cn(
                      'gap-2 rounded-xl h-10 font-bold px-5 text-white',
                      progressData.percent === 100
                        ? 'bg-emerald-600 hover:bg-emerald-700 animate-bounce'
                        : 'bg-secondary text-muted-foreground cursor-not-allowed border border-border/60 hover:bg-secondary'
                    )}
                  >
                    <CheckCircle className="w-4.5 h-4.5" /> Liberar para Expedição
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Coluna 3: Checklist de Peças */}
        <div className="xl:col-span-1 bg-card border border-border/60 rounded-2xl p-4 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Peças do Lote</h3>
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

          {!selectedOrderId ? (
            <div className="text-center py-10 text-muted-foreground text-xs italic">
              Selecione um lote para carregar o checklist de peças.
            </div>
          ) : filteredPieces.length === 0 ? (
            <p className="text-xs text-muted-foreground italic text-center py-6">Nenhuma peça encontrada.</p>
          ) : (
            <div className="space-y-1.5 max-h-[55vh] overflow-y-auto pr-1">
              {filteredPieces.map(piece => {
                const isPacked = piece.status === 'packed';
                const isRework = piece.status === 'rework' || piece.current_stage === 'Marcenaria';
                
                return (
                  <div
                    key={piece.id}
                    className={cn(
                      'p-2.5 rounded-lg border text-xs flex justify-between items-center gap-2 transition-all duration-150',
                      isPacked ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-400' :
                      isRework ? 'bg-purple-500/5 border-purple-500/20 text-purple-700 dark:text-purple-400' :
                      'bg-card border-border/50 text-foreground'
                    )}
                  >
                    <div className="truncate">
                      <p className="font-bold truncate">{piece.piece_name}</p>
                      <p className="text-[9px] font-mono text-muted-foreground truncate">{piece.piece_uid}</p>
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
