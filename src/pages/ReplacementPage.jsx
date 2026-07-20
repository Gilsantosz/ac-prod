import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import PageHeader from '@/components/ui/PageHeader';
import OperationalLoginGate from '@/components/entry/OperationalLoginGate';
import { useOperatorSession } from '@/hooks/useOperatorSession';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { RefreshCw, Play, Search, ShieldAlert, PlusCircle, CheckCircle, PackageOpen, HelpCircle } from 'lucide-react';

export default function ReplacementPage() {
  return (
    <OperationalLoginGate>
      <ReplacementWorkbench />
    </OperationalLoginGate>
  );
}

function ReplacementWorkbench() {
  const { operatorName, operatorId, selectedCellName } = useOperatorSession();
  const [rejectedPieces, setRejectedPieces] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Form State para Entrada Avulsa
  const [pieceUid, setPieceUid] = useState('');
  const [pieceName, setPieceName] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [cellName, setCellName] = useState(selectedCellName || 'Corte');
  const [notes, setNotes] = useState('Finalização avulsa / atraso');
  const [submitting, setSubmitting] = useState(false);

  // Modal para Concluir Reposição de peça da lista
  const [selectedPiece, setSelectedPiece] = useState(null);
  const [quickCell, setQuickCell] = useState('Corte');
  const [quickSubmitting, setQuickSubmitting] = useState(false);

  // Carregar lista de peças reprovadas
  const loadRejectedPieces = async () => {
    setLoadingList(true);
    try {
      const { data, error } = await supabase
        .from('production_pieces')
        .select(`
          id,
          piece_uid,
          piece_name,
          status,
          is_replacement,
          completed_steps,
          route_steps,
          current_stage,
          updated_at,
          environment,
          production_lots (
            lot_code,
            production_orders (
              customer_name
            )
          )
        `)
        .eq('status', 'rejected')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setRejectedPieces(data || []);
    } catch (err) {
      console.error(err);
      toast.error('Erro ao carregar peças reprovadas: ' + err.message);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadRejectedPieces();
    
    // Inscrever em tempo real na tabela de peças
    const channel = supabase
      .channel('replacement-pieces-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'production_pieces' },
        () => {
          loadRejectedPieces();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Submit Entrada Avulsa/Atrasada
  const handleSubmitIndependent = async (e) => {
    e.preventDefault();
    if (!pieceUid.trim()) {
      toast.error('O código de barras da peça é obrigatório.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        piece_uid: pieceUid.trim().toUpperCase(),
        piece_name: pieceName.trim() || undefined,
        lot_code: lotCode.trim() || undefined,
        customer_name: customerName.trim() || undefined,
        cell_name: cellName,
        operator_name: operatorName,
        operator_id: operatorId,
        notes: notes.trim()
      };

      const { data, error } = await supabase.rpc('register_independent_finish', { p_payload: payload });

      if (error) throw error;

      if (data && data.success) {
        toast.success(data.message || 'Peça registrada e finalizada com sucesso!');
        setPieceUid('');
        setPieceName('');
        setLotCode('');
        setCustomerName('');
        loadRejectedPieces();
      } else {
        toast.error(data?.message || 'Falha ao registrar peça.');
      }
    } catch (err) {
      console.error(err);
      toast.error('Erro ao salvar peça avulsa: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Submit Liberação/Conclusão de Reposição para peça da lista
  const handleQuickRelease = async (e) => {
    e.preventDefault();
    if (!selectedPiece) return;
    setQuickSubmitting(true);
    try {
      const payload = {
        piece_uid: selectedPiece.piece_uid,
        piece_name: selectedPiece.piece_name,
        lot_code: selectedPiece.production_lots?.lot_code,
        customer_name: selectedPiece.production_lots?.production_orders?.customer_name,
        cell_name: quickCell,
        operator_name: operatorName,
        operator_id: operatorId,
        notes: 'Reinserção/Reposição autorizada'
      };

      const { data, error } = await supabase.rpc('register_independent_finish', { p_payload: payload });

      if (error) throw error;

      if (data && data.success) {
        toast.success(`Reposição da peça ${selectedPiece.piece_uid} liberada com sucesso na célula ${quickCell}!`);
        setSelectedPiece(null);
        loadRejectedPieces();
      } else {
        toast.error(data?.message || 'Falha ao liberar reposição.');
      }
    } catch (err) {
      console.error(err);
      toast.error('Erro ao liberar reposição: ' + err.message);
    } finally {
      setQuickSubmitting(false);
    }
  };

  // Filtragem local de peças reprovadas
  const filteredPieces = rejectedPieces.filter(p => {
    const term = searchTerm.toLowerCase();
    return (
      String(p.piece_uid).toLowerCase().includes(term) ||
      String(p.piece_name).toLowerCase().includes(term) ||
      String(p.production_lots?.lot_code).toLowerCase().includes(term) ||
      String(p.production_lots?.production_orders?.customer_name).toLowerCase().includes(term)
    );
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      <PageHeader
        title="Reposição de Peças & Conclusão de Atrasos"
        subtitle="Gerencie e reinsera peças reprovadas no fluxo de produção ou registre conclusões atrasadas/avulsas sem planejamento prévio."
        icon={RefreshCw}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Painel Esquerdo: Fila de Reposição */}
        <div className="lg:col-span-7 bg-card border border-border/60 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-extrabold flex items-center gap-1.5 text-rose-600">
                <ShieldAlert className="w-5 h-5 shrink-0" />
                Peças Reprovadas Aguardando Reposição
              </h2>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Lista de peças rejeitadas nas células de produção aguardando re-entrada no sistema.
              </p>
            </div>
            <Button
              onClick={loadRejectedPieces}
              disabled={loadingList}
              variant="outline"
              size="xs"
              className="h-8 rounded-lg font-bold shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingList ? 'animate-spin' : ''}`} />
              Atualizar Fila
            </Button>
          </div>

          {/* Busca */}
          <div className="relative">
            <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por UID, nome da peça, lote ou cliente..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 rounded-xl border-border/50 text-xs bg-background/50 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500"
            />
          </div>

          {/* Lista de Peças */}
          <div className="border border-border/40 rounded-xl overflow-hidden bg-background/30 max-h-[500px] overflow-y-auto">
            {loadingList && rejectedPieces.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground flex flex-col items-center justify-center space-y-2">
                <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground/40" />
                <p className="text-xs">Carregando peças reprovadas...</p>
              </div>
            ) : filteredPieces.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground flex flex-col items-center justify-center space-y-2">
                <HelpCircle className="w-10 h-10 text-muted-foreground/30" />
                <div>
                  <p className="font-bold text-foreground text-sm">Nenhuma peça reprovada localizada</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 max-w-[280px] mx-auto">
                    {searchTerm ? 'Experimente buscar por outro termo ou limpe o campo.' : 'Não há peças marcadas como REPROVADAS atualmente no sistema.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border/40 text-xs">
                {filteredPieces.map((piece) => (
                  <div key={piece.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-secondary/20 transition-colors">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-foreground bg-secondary/50 px-2 py-0.5 rounded-lg border border-border/50 select-all">
                          {piece.piece_uid}
                        </span>
                        <Badge variant="destructive" className="text-[9px] h-4.5 px-1.5 uppercase font-bold shrink-0">
                          REPROVADA
                        </Badge>
                        {piece.is_replacement && (
                          <Badge variant="outline" className="text-[9px] h-4.5 px-1.5 border-amber-500/20 bg-amber-500/5 text-amber-600 font-bold shrink-0">
                            Reposição
                          </Badge>
                        )}
                      </div>
                      <p className="font-bold text-foreground truncate">{piece.piece_name}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                        <p>Lote: <span className="font-semibold text-foreground">{piece.production_lots?.lot_code || 'N/A'}</span></p>
                        <p>Cliente: <span className="font-semibold text-foreground">{piece.production_lots?.production_orders?.customer_name || 'N/A'}</span></p>
                        <p>Etapa Falha: <span className="font-semibold text-rose-600 uppercase">{piece.current_stage || 'N/A'}</span></p>
                      </div>
                    </div>

                    <Button
                      onClick={() => {
                        setSelectedPiece(piece);
                        setQuickCell(piece.current_stage || 'Corte');
                      }}
                      className="rounded-xl font-bold h-8 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 self-end sm:self-center"
                    >
                      <Play className="w-3.5 h-3.5 mr-1" />
                      Liberar Reposição
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Painel Direito: Entrada Avulsa */}
        <div className="lg:col-span-5 bg-card border border-border/60 rounded-2xl p-5 shadow-sm space-y-4">
          <div>
            <h2 className="text-sm font-extrabold flex items-center gap-1.5 text-foreground">
              <PlusCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              Entrada Avulsa / Produção Atrasada
            </h2>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Reinsera e finalize peças diretamente na produção, mesmo que estejam sem registro ou andamento anterior.
            </p>
          </div>

          <form onSubmit={handleSubmitIndependent} className="space-y-4 text-xs">
            {/* UID */}
            <div className="space-y-1.5">
              <Label htmlFor="piece-uid" className="font-bold text-muted-foreground">Código de Barras da Peça *</Label>
              <Input
                id="piece-uid"
                placeholder="Ex: 09907312"
                value={pieceUid}
                onChange={(e) => setPieceUid(e.target.value)}
                required
                className="h-10 rounded-xl border-border/60 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500 font-mono text-sm"
              />
            </div>

            {/* Informações Auxiliares (Expandível / Opcional) */}
            <div className="p-3 bg-secondary/25 border border-border/40 rounded-xl space-y-3">
              <p className="font-bold text-[10px] text-muted-foreground uppercase tracking-wider">Metadados da Peça (Criada se não existir)</p>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="piece-name" className="text-[10px] font-bold text-muted-foreground">Nome da Peça</Label>
                  <Input
                    id="piece-name"
                    placeholder="Ex: LATERAL ESQUERDA"
                    value={pieceName}
                    onChange={(e) => setPieceName(e.target.value)}
                    className="h-8 rounded-lg text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="lot-code" className="text-[10px] font-bold text-muted-foreground">Código do Lote</Label>
                  <Input
                    id="lot-code"
                    placeholder="Ex: LOTE-AVULSO"
                    value={lotCode}
                    onChange={(e) => setLotCode(e.target.value)}
                    className="h-8 rounded-lg text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="customer-name" className="text-[10px] font-bold text-muted-foreground">Cliente</Label>
                <Input
                  id="customer-name"
                  placeholder="Ex: JOÃO SILVA"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="h-8 rounded-lg text-xs"
                />
              </div>
            </div>

            {/* Célula de Produção */}
            <div className="space-y-1.5">
              <Label htmlFor="cell-name" className="font-bold text-muted-foreground">Célula / Posto de Coleta *</Label>
              <select
                id="cell-name"
                value={cellName}
                onChange={(e) => setCellName(e.target.value)}
                className="w-full h-10 rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
              >
                <option value="Corte">Corte</option>
                <option value="Borda">Borda</option>
                <option value="Usinagem">Usinagem</option>
                <option value="Marcenaria">Marcenaria</option>
                <option value="Embalagem">Embalagem</option>
              </select>
            </div>

            {/* Observações */}
            <div className="space-y-1.5">
              <Label htmlFor="notes" className="font-bold text-muted-foreground">Observações</Label>
              <Input
                id="notes"
                placeholder="Motivo da inserção avulsa..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="h-9 rounded-xl border-border/60 text-xs"
              />
            </div>

            {/* Submit */}
            <Button
              type="submit"
              disabled={submitting}
              className="w-full h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition-all"
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Registrando Entrada...
                </>
              ) : (
                <>
                  <PlusCircle className="w-4 h-4 mr-2" />
                  Registrar Entrada / Conclusão
                </>
              )}
            </Button>
          </form>
        </div>

      </div>

      {/* Modal / Dialog de Confirmação Rápida de Liberação */}
      {selectedPiece && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border/60 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4">
            <div className="space-y-1.5">
              <h3 className="text-base font-extrabold text-foreground flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-emerald-500" />
                Confirmar Liberação de Reposição
              </h3>
              <p className="text-xs text-muted-foreground">
                A peça reprovada será reintroduzida no fluxo produtivo e marcada como concluída na célula selecionada.
              </p>
            </div>

            <div className="bg-secondary/40 p-3 rounded-xl border border-border/40 text-xs space-y-1.5">
              <p className="font-bold font-mono text-foreground">UID: {selectedPiece.piece_uid}</p>
              <p className="text-muted-foreground truncate">Nome: <span className="text-foreground font-semibold">{selectedPiece.piece_name}</span></p>
              <p className="text-muted-foreground">Lote: <span className="text-foreground font-semibold">{selectedPiece.production_lots?.lot_code || 'N/A'}</span></p>
            </div>

            <form onSubmit={handleQuickRelease} className="space-y-4">
              <div className="space-y-1.5 text-xs">
                <Label htmlFor="quick-cell" className="font-bold text-muted-foreground">Célula de Destino da Reposição</Label>
                <select
                  id="quick-cell"
                  value={quickCell}
                  onChange={(e) => setQuickCell(e.target.value)}
                  className="w-full h-10 rounded-xl border border-border/60 bg-background px-3 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
                >
                  <option value="Corte">Corte</option>
                  <option value="Borda">Borda</option>
                  <option value="Usinagem">Usinagem</option>
                  <option value="Marcenaria">Marcenaria</option>
                  <option value="Embalagem">Embalagem</option>
                </select>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedPiece(null)}
                  className="flex-1 h-10 rounded-xl font-bold"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={quickSubmitting}
                  className="flex-1 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                >
                  {quickSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Liberando...
                    </>
                  ) : (
                    'Confirmar'
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
