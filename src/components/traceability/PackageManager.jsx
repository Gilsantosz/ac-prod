import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Box, Plus, CheckCircle, RefreshCw, Package,
  Lock, Unlock, Trash2, QrCode, Play, AlertCircle, ArrowRight
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

export default function PackageManager({ trace }) {
  const qc = useQueryClient();
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [activeVolumeId, setActiveVolumeId] = useState(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [isSubmittingScan, setIsSubmittingScan] = useState(false);

  // Lotes aguardando embalagem ou em embalagem
  const readyOrders = trace.lots.data.filter(l =>
    l.status === 'waiting_packaging' || l.status === 'in_progress' || l.status === 'ready_to_pack'
  );

  // Volumes da ordem/lote selecionado
  const { data: progressData, isLoading: isLoadingProgress, refetch: refetchProgress } = useQuery({
    queryKey: ['packing-progress', selectedOrderId],
    queryFn: () => getPackingProgress(selectedOrderId),
    enabled: !!selectedOrderId,
  });

  const selectedLot = trace.lots.data.find(l => l.id === selectedOrderId);
  const activeVolume = progressData?.volumes?.find(v => v.id === activeVolumeId);

  // Peças do volume ativo
  const { data: activeVolumeItems = [], isLoading: isLoadingItems, refetch: refetchItems } = useQuery({
    queryKey: ['packing-volume-items', activeVolumeId],
    queryFn: () => getVolumeItems(activeVolumeId),
    enabled: !!activeVolumeId,
    initialData: [],
  });

  // Atualizar volume selecionado se a lista mudar
  useEffect(() => {
    if (progressData?.volumes && progressData.volumes.length > 0) {
      if (!activeVolumeId || !progressData.volumes.some(v => v.id === activeVolumeId)) {
        setActiveVolumeId(progressData.volumes[0].id);
      }
    } else {
      setActiveVolumeId(null);
    }
  }, [progressData, activeVolumeId]);

  // ─── Criar novo volume ────────────────────────────────────────
  const handleCreateVolume = async () => {
    if (!selectedLot) return;
    try {
      const vol = await createVolume(selectedLot.id, selectedLot.production_orders?.id);
      toast.success(`📦 Volume ${vol.volume_code} criado com sucesso!`);
      refetchProgress();
      setActiveVolumeId(vol.id);
    } catch (e) {
      toast.error(e?.message || 'Falha ao criar volume');
    }
  };

  // ─── Fechar volume ────────────────────────────────────────────
  const handleCloseVolume = async (volId) => {
    try {
      await closeVolume(volId);
      toast.success('✓ Volume fechado e lacrado!');
      refetchProgress();
      refetchItems();
    } catch (e) {
      toast.error(e?.message);
    }
  };

  // ─── Reabrir volume ───────────────────────────────────────────
  const handleReopenVolume = async (volId) => {
    try {
      await reopenVolumeWithPermission(volId);
      toast.success('🔓 Volume reaberto para edição!');
      refetchProgress();
      refetchItems();
    } catch (e) {
      toast.error(e?.message);
    }
  };

  // ─── Bipar Peça ───────────────────────────────────────────────
  const handleScanSubmit = async (e) => {
    e.preventDefault();
    if (!barcodeInput.trim() || !activeVolumeId) return;

    setIsSubmittingScan(true);
    try {
      await scanPieceToVolume(activeVolumeId, barcodeInput.trim());
      toast.success('✓ Peça adicionada ao volume!');
      setBarcodeInput('');
      refetchItems();
      refetchProgress();
    } catch (err) {
      toast.error(err.message || 'Erro ao bipar peça');
    } finally {
      setIsSubmittingScan(false);
    }
  };

  // ─── Remover Peça ─────────────────────────────────────────────
  const handleRemoveItem = async (itemId) => {
    try {
      await removePieceFromVolume(itemId);
      toast.success('Lixeira: Peça removida do volume.');
      refetchItems();
      refetchProgress();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // ─── Imprimir Etiqueta do Volume ──────────────────────────────
  const handlePrintLabel = (volume) => {
    if (!volume) return;
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
          <title>Etiqueta de Volume - ${volume.volume_code}</title>
          <style>
            body { font-family: 'Courier New', monospace; padding: 20px; text-align: center; }
            .label-box { border: 3px solid #000; padding: 20px; width: 380px; margin: 0 auto; border-radius: 8px; }
            .title { font-size: 20px; font-weight: bold; margin-bottom: 10px; text-transform: uppercase; }
            .code { font-size: 26px; font-weight: bold; margin: 15px 0; background: #000; color: #fff; padding: 5px; }
            .meta { text-align: left; font-size: 13px; line-height: 1.6; }
            .footer { font-size: 10px; margin-top: 20px; color: #555; }
          </style>
        </head>
        <body onload="window.print(); window.close();">
          <div class="label-box">
            <div class="title">Leo Flow — Volume</div>
            <div class="code">${volume.volume_code}</div>
            <div class="meta">
              <strong>LOTE:</strong> ${selectedLot?.lot_code}<br/>
              <strong>CLIENTE:</strong> ${selectedLot?.production_orders?.customer_name || 'Sob Medida'}<br/>
              <strong>PEDIDO:</strong> ${selectedLot?.production_orders?.order_code || selectedLot?.order_id || ''}<br/>
              <strong>GERADO EM:</strong> ${new Date(volume.created_at).toLocaleString('pt-BR')}<br/>
            </div>
            <div class="footer">Leo Flow Rastreabilidade de Chão de Fábrica</div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
      {/* ── Lista de Lotes ─────────────────────────────────────── */}
      <div className="lg:col-span-1 space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Lotes Aguardando Embalagem / Coleta
        </h3>

        {readyOrders.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground border border-dashed border-border/40 rounded-2xl">
            <Box className="w-6 h-6 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Nenhum lote pendente de embalagem</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-1">
            {readyOrders.map(lot => (
              <button
                key={lot.id}
                onClick={() => {
                  setSelectedOrderId(lot.id);
                  setActiveVolumeId(null);
                }}
                className={cn(
                  'w-full text-left px-4 py-3 rounded-xl border transition-all duration-150',
                  selectedOrderId === lot.id
                    ? 'border-[#76FB91]/60 bg-[#76FB91]/5 shadow-sm'
                    : 'border-border/50 bg-card hover:border-border/80'
                )}
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <p className="font-semibold text-sm text-foreground">{lot.lot_code}</p>
                    <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                      {lot.production_orders?.customer_name || 'Móvel Planejado'}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-[10px] bg-secondary/30">
                    {lot.status === 'waiting_packaging' ? 'Pronto Embalar' : 'Em Produção'}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Gerenciamento de Embalagem ─────────────────────────── */}
      <div className="lg:col-span-2 space-y-4">
        {!selectedOrderId ? (
          <div className="text-center py-20 border border-dashed border-border/40 rounded-2xl text-muted-foreground">
            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium text-foreground">Selecione um lote de produção</p>
            <p className="text-sm mt-1">Crie volumes físicos e bipa as peças para lacrar a carga</p>
          </div>
        ) : (
          <>
            {selectedLot && (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="font-bold text-foreground text-lg">{selectedLot.lot_code}</h3>
                  <p className="text-sm text-muted-foreground">
                    Cliente: {selectedLot.production_orders?.customer_name || 'Sob Medida'}
                  </p>
                </div>
                <Button
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={handleCreateVolume}
                >
                  <Plus className="w-4 h-4" />
                  Criar Volume
                </Button>
              </div>
            )}

            {/* Progresso Geral de Embalagem */}
            {progressData && (
              <div className="border border-border/60 bg-card/40 rounded-2xl p-4 space-y-2">
                <div className="flex justify-between items-center text-xs text-muted-foreground">
                  <span>Progresso de Embalagem do Lote</span>
                  <span className="font-bold text-foreground">
                    {progressData.totalPacked} / {progressData.totalExpected} peças ({progressData.percent}%)
                  </span>
                </div>
                <div className="w-full bg-secondary h-2.5 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                    style={{ width: `${progressData.percent}%` }}
                  />
                </div>
              </div>
            )}
            {progressData && progressData.percent === 100 && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 flex justify-between items-center gap-3 text-xs text-emerald-700 dark:text-emerald-400">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 shrink-0 text-emerald-500" />
                  <div>
                    <p className="font-bold">Lote 100% Embalado!</p>
                    <p className="text-[10px] opacity-80 font-normal">Todos os volumes deste lote foram devidamente fechados e lacrados.</p>
                  </div>
                </div>
                <Button asChild className="bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] h-8 gap-1.5 shrink-0">
                  <Link to="/rastreabilidade?tab=shipping">
                    Ir para Expedição <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </Button>
              </div>
            )}



            {isLoadingProgress ? (
              <div className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin" /> Carregando volumes…
              </div>
            ) : progressData?.volumes?.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-border/40 rounded-2xl text-muted-foreground">
                <Box className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Nenhum volume cadastrado</p>
                <p className="text-xs mt-1">Clique em "Criar Volume" para abrir a primeira caixa.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Abas Verticais de Volumes */}
                <div className="md:col-span-1 space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                  {progressData?.volumes?.map(v => (
                    <button
                      key={v.id}
                      onClick={() => setActiveVolumeId(v.id)}
                      className={cn(
                        'w-full text-left p-3 rounded-xl border flex items-center justify-between transition-all',
                        activeVolumeId === v.id
                          ? 'border-emerald-500/50 bg-emerald-500/5 shadow-sm'
                          : 'border-border/50 bg-card hover:border-border/80'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Box className={cn('w-4 h-4', v.status === 'closed' ? 'text-emerald-500' : 'text-muted-foreground')} />
                        <span className="text-sm font-semibold">{v.volume_code.split('-V')[1]}</span>
                      </div>
                      <Badge variant={v.status === 'closed' ? 'default' : 'outline'} className={cn(
                        v.status === 'closed' ? 'bg-emerald-600 text-white border-0' : 'text-[10px]'
                      )}>
                        {v.status === 'closed' ? 'Lacre' : 'Aberto'}
                      </Badge>
                    </button>
                  ))}
                </div>

                {/* Painel do Volume Ativo */}
                <div className="md:col-span-2 border border-border/60 bg-card rounded-2xl p-4 space-y-4">
                  {activeVolume ? (
                    <>
                      <div className="flex justify-between items-start gap-2 flex-wrap">
                        <div>
                          <h4 className="font-bold text-foreground">{activeVolume.volume_code}</h4>
                          <span className="text-xs text-muted-foreground">
                            Criado em: {new Date(activeVolume.created_at).toLocaleDateString('pt-BR')}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-8"
                            onClick={() => handlePrintLabel(activeVolume)}
                          >
                            Imprimir Etiqueta
                          </Button>
                          {activeVolume.status === 'open' ? (
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8 gap-1"
                              onClick={() => handleCloseVolume(activeVolume.id)}
                            >
                              <Lock className="w-3 h-3" /> Fechar Volume
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="destructive"
                              className="text-xs h-8 gap-1"
                              onClick={() => handleReopenVolume(activeVolume.id)}
                            >
                              <Unlock className="w-3 h-3" /> Reabrir
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Input de Bipagem se Volume Aberto */}
                      {activeVolume.status === 'open' ? (
                        <form onSubmit={handleScanSubmit} className="flex gap-2">
                          <div className="relative flex-1">
                            <QrCode className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                            <Input
                              placeholder="Bipar etiqueta da peça (Ex: PC-2026...)"
                              value={barcodeInput}
                              onChange={(e) => setBarcodeInput(e.target.value)}
                              className="pl-9 h-9"
                              disabled={isSubmittingScan}
                              autoFocus
                            />
                          </div>
                          <Button
                            type="submit"
                            size="sm"
                            className="bg-secondary hover:bg-secondary/80 h-9"
                            disabled={isSubmittingScan || !barcodeInput.trim()}
                          >
                            {isSubmittingScan ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                          </Button>
                        </form>
                      ) : (
                        <div className="bg-emerald-500/5 border border-emerald-500/20 text-emerald-600 rounded-xl p-3 flex items-center gap-2 text-xs">
                          <CheckCircle className="w-4 h-4 shrink-0" />
                          <span>Este volume está fechado e lacrado. Nenhuma peça pode ser adicionada ou removida.</span>
                        </div>
                      )}

                      {/* Lista de Peças Embaladas no Volume */}
                      <div className="space-y-2">
                        <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Peças no Volume ({activeVolumeItems.length})
                        </h5>
                        {isLoadingItems ? (
                          <p className="text-xs text-muted-foreground">Carregando itens...</p>
                        ) : activeVolumeItems.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">Nenhuma peça bipada neste volume.</p>
                        ) : (
                          <div className="space-y-1.5 max-h-[30vh] overflow-y-auto">
                            {activeVolumeItems.map(item => (
                              <div
                                key={item.id}
                                className="flex items-center justify-between gap-2 p-2 bg-secondary/30 hover:bg-secondary/50 rounded-lg text-xs"
                              >
                                <div className="truncate">
                                  <p className="font-medium text-foreground truncate">
                                    {item.production_pieces?.piece_name || 'Peça sem nome'}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground font-mono">
                                    {item.traceability_code} · {item.production_pieces?.material} {item.production_pieces?.color}
                                  </p>
                                </div>
                                {activeVolume.status === 'open' && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
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
                      <p className="text-sm">Selecione ou crie um volume para visualizar</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Peças Faltantes no Lote */}
            {progressData && progressData.missingPieces?.length > 0 && (
              <div className="border border-amber-500/20 bg-amber-500/5 rounded-2xl p-4 space-y-2">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-bold text-sm">
                  <AlertCircle className="w-4 h-4" />
                  <span>Peças Pendentes de Embalagem ({progressData.missingPieces.length})</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[20vh] overflow-y-auto pr-1">
                  {progressData.missingPieces.map(p => (
                    <div key={p.id} className="text-xs bg-card/60 border p-2 rounded-lg flex justify-between items-center gap-2">
                      <div className="truncate">
                        <p className="font-semibold truncate">{p.piece_name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{p.piece_uid}</p>
                      </div>
                      <Badge variant="outline" className="text-[9px] shrink-0">
                        {p.current_stage}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
