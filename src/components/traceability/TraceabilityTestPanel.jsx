import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  Play, Trash2, Plus, CheckCircle,
  Radio, Smartphone, RefreshCw, Barcode, ShieldAlert, 
  ArrowRight, Info, Layers, Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import {
  deleteTraceabilityTestData,
  fetchTraceabilityTestDetails,
  fetchTraceabilityTestLogs,
  fetchTraceabilityTestReadings,
  generateTraceabilityTestLot,
  simulateTraceabilityTestReading,
} from '@/lib/traceabilityTestService';
import confetti from 'canvas-confetti';

export default function TraceabilityTestPanel() {
  const queryClient = useQueryClient();
  
  // Estados locais
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [selectedLotId, setSelectedLotId] = useState('');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [scanReaderType, setScanReaderType] = useState('rfid_fixed');
  const [scanCell, setScanCell] = useState('Célula A');
  const [scanStep, setScanStep] = useState('Corte');
  
  // ─── Query: Buscar Lotes de Teste ──────────────────────────────────
  const { data: testLots = [], refetch: refetchLots, isFetching: lotsLoading } = useQuery({
    queryKey: ['test-lots-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_lots')
        .select('*, production_orders(order_code)')
        .like('lot_code', 'LOTE-TEST-%')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    initialData: [],
    refetchInterval: 10000,
  });

  // Atualizar lote selecionado automaticamente quando um novo for gerado
  useEffect(() => {
    if (testLots.length > 0 && !selectedLotId) {
      setSelectedLotId(testLots[0].id);
    }
  }, [testLots, selectedLotId]);

  // Lote selecionado atualmente
  const currentLot = testLots.find(l => l.id === selectedLotId);

  // ─── Query: Buscar Itens e Rotas do Lote Selecionado ──────────────
  const { data: lotDetails = { items: [], routes: [], tags: [], mode: 'legacy' }, refetch: refetchDetails } = useQuery({
    queryKey: ['test-lot-details', selectedLotId],
    queryFn: async () => {
      return fetchTraceabilityTestDetails(selectedLotId);
    },
    enabled: !!selectedLotId,
    initialData: { items: [], routes: [], tags: [], mode: 'legacy' },
  });

  // Atualizar item selecionado para simulação automaticamente
  useEffect(() => {
    if (lotDetails.items.length > 0) {
      setSelectedItemId(lotDetails.items[0].id);
    } else {
      setSelectedItemId('');
    }
  }, [lotDetails.items]);

  const selectedItem = lotDetails.items.find(i => i.id === selectedItemId);

  // Auto-configurar Célula e Etapa corretas baseadas no item selecionado para facilitar testes felizes
  useEffect(() => {
    if (selectedItem) {
      setScanStep(selectedItem.current_step || 'Corte');
      setScanCell(selectedItem.current_cell || 'Célula A');
    }
  }, [selectedItem]);

  // ─── Query: Leituras de Teste Recentes (Dados Visíveis) ───────────
  const { data: testReadings = [], refetch: refetchReadings } = useQuery({
    queryKey: ['test-readings-list'],
    queryFn: async () => {
      return fetchTraceabilityTestReadings();
    },
    initialData: [],
    refetchInterval: 5000,
  });

  // ─── Query: Entradas de Produção de Teste ─────────────────────────
  const { data: testEntries = [], refetch: refetchEntries } = useQuery({
    queryKey: ['test-entries-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_entries')
        .select('*')
        .or('notes.ilike.%tag BARCODE-TEST-%,notes.ilike.%tag QRCODE-TEST-%,notes.ilike.%tag RFID-TEST-%,notes.ilike.%LOTE-TEST-%,notes.ilike.%PECA-TEST-%')
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
    initialData: [],
    refetchInterval: 5000,
  });

  // ─── Query: Logs de Rastreabilidade de Teste ──────────────────────
  const { data: testLogs = [], refetch: refetchLogs } = useQuery({
    queryKey: ['test-traceability-logs'],
    queryFn: async () => {
      return fetchTraceabilityTestLogs();
    },
    initialData: [],
    refetchInterval: 5000,
  });

  // Função geral de recarga de dados
  const refreshAll = useCallback(() => {
    refetchLots();
    refetchDetails();
    refetchReadings();
    refetchEntries();
    refetchLogs();
    queryClient.invalidateQueries({ queryKey: ['production'] });
    queryClient.invalidateQueries({ queryKey: ['production-stage-readings'] });
    queryClient.invalidateQueries({ queryKey: ['traceability-collection-kpis'] });
  }, [queryClient, refetchLots, refetchDetails, refetchReadings, refetchEntries, refetchLogs]);

  // ─── Ação: Gerar Lote de Teste Completo ───────────────────────────
  const handleGenerateTestLot = async () => {
    setGenerating(true);
    const randomId = Math.random().toString(36).substring(2, 6).toUpperCase();
    
    try {
      const { lot } = await generateTraceabilityTestLot(randomId);

      setSelectedLotId(lot.id);
      toast.success(`Lote de teste LOTE-TEST-${randomId} gerado com sucesso!`);
      refreshAll();
    } catch (err) {
      toast.error('Erro ao gerar dados de teste: ' + err.message);
      console.error(err);
    } finally {
      setGenerating(false);
    }
  };

  // ─── Ação: Simular Leitura ────────────────────────────────────────
  const handleSimulateScan = async () => {
    if (!selectedItemId) {
      toast.warning('Crie ou selecione um item de teste primeiro.');
      return;
    }

    setSimulating(true);
    try {
      // Descobrir qual tag enviar
      const itemTags = lotDetails.tags.filter(t => t.item_id === selectedItemId);
      let selectedTagValue = '';

      if (scanReaderType.startsWith('rfid')) {
        // Encontra tag rfid
        const rfidTag = itemTags.find(t => t.tag_type === 'rfid_epc');
        selectedTagValue = rfidTag ? rfidTag.tag_value : `RFID-TEST-${selectedItemId.substring(0, 5)}`;
      } else if (scanReaderType === 'camera_qrcode') {
        const qrTag = itemTags.find(t => t.tag_type === 'qrcode');
        selectedTagValue = qrTag ? qrTag.tag_value : `QRCODE-TEST-${selectedItemId.substring(0, 5)}`;
      } else {
        const barcodeTag = itemTags.find(t => t.tag_type === 'barcode');
        selectedTagValue = barcodeTag ? barcodeTag.tag_value : `BARCODE-TEST-${selectedItemId.substring(0, 5)}`;
      }

      // Executa o processamento
      const result = await simulateTraceabilityTestReading({
        mode: lotDetails.mode,
        lot: currentLot,
        item: selectedItem,
        tagValue: selectedTagValue,
        readerType: scanReaderType,
        cellName: scanCell,
        stepName: scanStep,
        operator: 'Operador Teste Coletas',
        shift: '1º Turno'
      });

      if (result?.success) {
        toast.success(result.message || 'Simulação de leitura APROVADA!');
        confetti({ particleCount: 80, spread: 60, origin: { y: 0.8 } });
      } else {
        toast.warning(result?.message || 'Simulação de leitura BLOQUEADA.');
      }
      refreshAll();
    } catch (err) {
      toast.error('Falha na simulação: ' + err.message);
      console.error(err);
    } finally {
      setSimulating(false);
    }
  };

  // ─── Ação: Apagar Todos os Dados de Teste (Limpeza) ────────────────
  const handleDeleteTestData = async () => {
    if (!confirm('Deseja realmente apagar todos os dados de teste gerados por este simulador? Isso limpará permanentemente os lotes, rotas, tags, coletas e entradas que comecem com "TEST-", "LOTE-TEST-" ou "ORDEM-TEST-".')) {
      return;
    }

    setDeleting(true);
    try {
      const data = await deleteTraceabilityTestData();

      if (data?.success) {
        toast.success(
          `Limpeza concluída! Removido: ${data.deleted_readings} leituras, ` +
          `${data.deleted_entries} entradas, ${data.deleted_lots} lotes.`
        );
        setSelectedLotId('');
        refreshAll();
      } else {
        toast.error(data?.message || 'Erro inesperado ao limpar dados.');
      }
    } catch (err) {
      toast.error('Falha ao limpar dados do banco: ' + err.message);
      console.error(err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Top Panel: Controles Principais ── */}
      <div className="grid md:grid-cols-3 gap-5">
        
        {/* Card 1: Geração e Seleção de Dados */}
        <Card className="border border-border/80 shadow-sm relative overflow-hidden bg-card">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-500" /> 1. Gerar Dados de Teste
            </CardTitle>
            <CardDescription>Crie lotes e peças simulados para testar sem corromper a produção real.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button 
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2 font-semibold shadow-sm transition-all"
              onClick={handleGenerateTestLot}
              disabled={generating}
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Gerando estrutura...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Gerar Lote de Teste Completo
                </>
              )}
            </Button>

            <div className="space-y-1.5 pt-2 border-t border-border/60">
              <label htmlFor="select-test-lot" className="text-xs font-semibold text-muted-foreground block">Selecionar lote sob teste:</label>
              <select
                id="select-test-lot"
                value={selectedLotId}
                onChange={(e) => setSelectedLotId(e.target.value)}
                disabled={lotsLoading || testLots.length === 0}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              >
                {testLots.length === 0 ? (
                  <option value="">Nenhum lote de teste ativo</option>
                ) : (
                  testLots.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.lot_code} ({l.progress_percent}% Concluído)
                    </option>
                  ))
                )}
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Painel de Simulação */}
        <Card className="border border-border/80 shadow-sm relative overflow-hidden bg-card">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 to-blue-500" />
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Play className="w-5 h-5 text-sky-500" /> 2. Simular Coleta
            </CardTitle>
            <CardDescription>Simule a leitura por antenas RFID ou câmeras de celular.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            
            {/* Seleção de Peça */}
            <div className="space-y-1">
              <label htmlFor="select-test-item" className="text-xs font-semibold text-muted-foreground block">Selecione a peça:</label>
              <select
                id="select-test-item"
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                disabled={lotDetails.items.length === 0}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                {lotDetails.items.length === 0 ? (
                  <option value="">Crie um lote de teste primeiro</option>
                ) : (
                  lotDetails.items.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.item_code} - {item.product_name} ({item.status})
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Configuração do Leitor */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label htmlFor="select-reader-type" className="text-xs font-semibold text-muted-foreground block">Dispositivo:</label>
                <select
                  id="select-reader-type"
                  value={scanReaderType}
                  onChange={(e) => setScanReaderType(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs focus:outline-none"
                >
                  <option value="rfid_fixed">RFID Fixo (Antena)</option>
                  <option value="rfid_handheld">RFID Manual (Pistola)</option>
                  <option value="camera_qrcode">Celular - Câmera QR</option>
                  <option value="camera_barcode">Celular - Câmera Código</option>
                </select>
              </div>
              
              <div className="space-y-1">
                <label htmlFor="select-scan-cell" className="text-xs font-semibold text-muted-foreground block">Célula Leitura:</label>
                <select
                  id="select-scan-cell"
                  value={scanCell}
                  onChange={(e) => setScanCell(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs focus:outline-none"
                >
                  <option value="Célula A">Célula A (Esperado: Corte)</option>
                  <option value="Célula B">Célula B (Esperado: Bordo)</option>
                  <option value="Célula C">Célula C (Esperado: Usinagem)</option>
                  <option value="Célula D">Célula D (Incorreta)</option>
                </select>
              </div>
            </div>

            {/* Configuração da Etapa */}
            <div className="space-y-1 pb-1">
              <label htmlFor="select-scan-step" className="text-xs font-semibold text-muted-foreground block">Etapa Leitura:</label>
              <select
                id="select-scan-step"
                value={scanStep}
                onChange={(e) => setScanStep(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none"
              >
                <option value="Corte">Corte (Etapa 1)</option>
                <option value="Bordo">Bordo (Etapa 2)</option>
                <option value="Usinagem">Usinagem (Etapa 3)</option>
              </select>
            </div>

            <Button 
              className="w-full bg-sky-600 hover:bg-sky-700 text-white gap-2 font-semibold shadow-sm transition-all"
              onClick={handleSimulateScan}
              disabled={simulating || !selectedItemId}
            >
              {simulating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Processando leitura...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-white" />
                  Simular Leitura
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Card 3: Limpeza de Banco */}
        <Card className="border border-border/80 shadow-sm relative overflow-hidden bg-card">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-500 to-orange-500" />
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-500" /> 3. Apagar Dados de Teste
            </CardTitle>
            <CardDescription>Limpe os dados do banco para mantê-lo organizado após os testes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3 text-xs text-amber-800 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-300 flex gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0" />
              <span>Esta ação exclui apenas ordens, lotes, tags, leituras e entradas criadas com prefixos de simulação de teste (`TEST-`).</span>
            </div>
            
            <Button 
              variant="destructive"
              className="w-full gap-2 font-semibold shadow-sm transition-all"
              onClick={handleDeleteTestData}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Apagando dados...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  Limpar Todos os Dados de Teste
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Lote Selecionado: Progresso e Estrutura ── */}
      {currentLot && (
        <Card className="border border-border/60 bg-card">
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Layers className="w-4 h-4 text-emerald-500" /> Detalhes da Estrutura do Lote: <strong className="font-mono text-foreground">{currentLot.lot_code}</strong></CardTitle>
              <CardDescription>Progresso do lote: {currentLot.progress_percent || 0}% · Peças Planejadas: {currentLot.planned_quantity ?? lotDetails.items.length}</CardDescription>
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-300 dark:border-emerald-900/40">Ordem: {currentLot.production_orders?.order_code}</Badge>
              <Badge variant="secondary" className="capitalize text-xs">{currentLot.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            
            {/* Itens do lote */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Peças e Tags Cadastradas</h4>
              <div className="overflow-x-auto rounded-lg border border-border/50">
                <table className="w-full text-sm text-left border-collapse">
                  <thead>
                    <tr className="bg-secondary/40 border-b border-border/50 text-muted-foreground text-xs font-semibold">
                      <th className="p-2.5">Código da Peça</th>
                      <th className="p-2.5">Nome do Produto</th>
                      <th className="p-2.5">Etapa Esperada</th>
                      <th className="p-2.5">Tags Produtivas Vinculadas</th>
                      <th className="p-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {lotDetails.items.map(item => {
                      const itemTags = lotDetails.tags.filter(t => t.item_id === item.id);
                      return (
                        <tr key={item.id} className="hover:bg-secondary/20 transition-colors">
                          <td className="p-2.5 font-mono text-xs font-semibold text-foreground">{item.item_code}</td>
                          <td className="p-2.5">{item.product_name}</td>
                          <td className="p-2.5">
                            <div className="flex items-center gap-1.5">
                              <Badge variant="outline" className="text-xs">{item.current_step || 'Início'}</Badge>
                              {item.current_cell && <span className="text-xs text-muted-foreground">({item.current_cell})</span>}
                            </div>
                          </td>
                          <td className="p-2.5">
                            <div className="flex flex-wrap gap-1.5">
                              {itemTags.map(tag => (
                                <Badge key={tag.id} variant="secondary" className="text-[10px] font-mono flex items-center gap-1 px-1.5 py-0.5">
                                  {tag.tag_type === 'rfid_epc' ? <Radio className="w-3 h-3 text-sky-500" /> : <Barcode className="w-3 h-3 text-emerald-500" />}
                                  {tag.tag_value}
                                </Badge>
                              ))}
                            </div>
                          </td>
                          <td className="p-2.5">
                            <Badge className={`text-xs ${
                              item.status === 'completed' ? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/10' :
                              item.status === 'in_progress' ? 'bg-sky-500/10 text-sky-600 hover:bg-sky-500/10' :
                              item.status === 'blocked' ? 'bg-red-500/10 text-red-600 hover:bg-red-500/10' :
                              'bg-slate-500/10 text-slate-600 hover:bg-slate-500/10'
                            }`}>
                              {item.status}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Rotas produtivas */}
            <div className="space-y-2 pt-2">
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Roteiro Produtivo (Fluxo Exigido)</h4>
              <div className="flex items-center gap-2 flex-wrap text-sm">
                {lotDetails.routes.map((route, idx) => (
                  <div key={route.id} className="flex items-center gap-2">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/80 bg-secondary/35">
                      <span className="font-bold text-xs text-muted-foreground">#{route.step_order}</span>
                      <strong className="text-foreground">{route.step_name}</strong>
                      <span className="text-xs text-muted-foreground">({route.cell_name})</span>
                    </div>
                    {idx < lotDetails.routes.length - 1 && <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                  </div>
                ))}
              </div>
            </div>

          </CardContent>
        </Card>
      )}

      {/* ── Tabelas de Dados Visíveis (Readings, Entries, Logs) ── */}
      <div className="grid lg:grid-cols-2 gap-6">
        
        {/* Leituras Gravadas em production_stage_readings */}
        <Card className="border border-border/60 bg-card">
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Radio className="w-4 h-4 text-sky-500" /> Leituras Registradas</CardTitle>
              <CardDescription>Histórico persistido das coletas realizadas pelo simulador.</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={refreshAll} title="Recarregar tabelas"><RefreshCw className="w-4 h-4" /></Button>
          </CardHeader>
          <CardContent>
            {testReadings.length === 0 ? (
              <div className="min-h-32 flex flex-col items-center justify-center border border-dashed border-border rounded-lg text-center p-4">
                <Info className="w-7 h-7 text-muted-foreground mb-2" />
                <p className="text-sm font-semibold">Nenhuma leitura de teste gravada.</p>
                <p className="text-xs text-muted-foreground mt-0.5">Use o painel de simulação para gerar leituras.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border/50">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-secondary/40 border-b border-border/50 text-muted-foreground font-semibold">
                      <th className="p-2">Hora</th>
                      <th className="p-2">Tag</th>
                      <th className="p-2">Leitor</th>
                      <th className="p-2">Célula / Etapa</th>
                      <th className="p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {testReadings.map(read => (
                      <tr key={read.id} className="hover:bg-secondary/10 transition-colors">
                        <td className="p-2 font-mono whitespace-nowrap text-muted-foreground">{read.hour}</td>
                        <td className="p-2 font-mono font-semibold text-foreground">{read.tag_value}</td>
                        <td className="p-2">
                          <span className="capitalize">{read.reader_type.replace('_', ' ')}</span>
                        </td>
                        <td className="p-2">
                          <span>{read.cell_name || '—'}</span>
                          <span className="text-muted-foreground mx-1">/</span>
                          <span>{read.step_name || '—'}</span>
                        </td>
                        <td className="p-2">
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            read.status === 'approved' ? 'bg-emerald-500/10 text-emerald-600' :
                            read.status === 'duplicated' ? 'bg-amber-500/10 text-amber-600' :
                            'bg-red-500/10 text-red-600'
                          }`}>
                            {read.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Entradas Geradas em production_entries */}
        <Card className="border border-border/60 bg-card">
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-500" /> Entradas de Produção</CardTitle>
              <CardDescription>Visualização da tabela `production_entries` (geradas pelas baixas).</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={refreshAll} title="Recarregar tabelas"><RefreshCw className="w-4 h-4" /></Button>
          </CardHeader>
          <CardContent>
            {testEntries.length === 0 ? (
              <div className="min-h-32 flex flex-col items-center justify-center border border-dashed border-border rounded-lg text-center p-4">
                <Info className="w-7 h-7 text-muted-foreground mb-2" />
                <p className="text-sm font-semibold">Nenhuma entrada de produção vinculada.</p>
                <p className="text-xs text-muted-foreground mt-0.5">Leituras aprovadas criam automaticamente entradas de produção de lote.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border/50">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-secondary/40 border-b border-border/50 text-muted-foreground font-semibold">
                      <th className="p-2">Hora</th>
                      <th className="p-2">Célula / Turno</th>
                      <th className="p-2">Produzido / Refugo</th>
                      <th className="p-2">Anotação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {testEntries.map(entry => (
                      <tr key={entry.id} className="hover:bg-secondary/10 transition-colors">
                        <td className="p-2 font-mono text-muted-foreground">{entry.hour}</td>
                        <td className="p-2">
                          <span>{entry.cell}</span>
                          <span className="text-muted-foreground mx-1">·</span>
                          <span className="text-muted-foreground">{entry.shift}</span>
                        </td>
                        <td className="p-2 font-semibold">
                          <span className="text-emerald-600">+{entry.produced}</span>
                          {entry.scrap > 0 && <span className="text-red-500 ml-1.5">-{entry.scrap} refugo</span>}
                        </td>
                        <td className="p-2 truncate max-w-[200px]" title={entry.notes}>
                          {entry.notes}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Logs de Rastreabilidade em traceability_logs */}
        <Card className="border border-border/60 bg-card lg:col-span-2">
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Smartphone className="w-4 h-4 text-purple-500" /> Logs de Rastreabilidade (Auditoria)</CardTitle>
              <CardDescription>Histórico de auditoria das ações realizadas pelo simulador.</CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={refreshAll} title="Recarregar tabelas"><RefreshCw className="w-4 h-4" /></Button>
          </CardHeader>
          <CardContent>
            {testLogs.length === 0 ? (
              <div className="min-h-24 flex flex-col items-center justify-center border border-dashed border-border rounded-lg text-center p-4">
                <p className="text-sm font-semibold text-muted-foreground">Nenhum log de auditoria de teste gerado.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border/50">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-secondary/40 border-b border-border/50 text-muted-foreground font-semibold">
                      <th className="p-2">Ação</th>
                      <th className="p-2">Entidade</th>
                      <th className="p-2">ID Entidade</th>
                      <th className="p-2">Detalhes (JSON)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40 font-mono">
                    {testLogs.map(log => (
                      <tr key={log.id} className="hover:bg-secondary/10 transition-colors">
                        <td className="p-2 text-foreground font-semibold">{log.action}</td>
                        <td className="p-2 text-muted-foreground">{log.entity}</td>
                        <td className="p-2 truncate max-w-[120px] text-muted-foreground">{log.entity_id}</td>
                        <td className="p-2 text-[10px] text-foreground max-w-[400px] truncate" title={JSON.stringify(log.details)}>
                          {JSON.stringify(log.details)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
