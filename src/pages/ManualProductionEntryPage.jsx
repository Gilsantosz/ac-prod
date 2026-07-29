import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Edit3, CheckCircle2, RefreshCw, Hash, User, FileText, Info, Building2,
  Layers, ShieldCheck, Check
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useOperatorSession } from '@/hooks/useOperatorSession';
import { getOperatorAllowedCells } from '@/lib/operatorCellRules';
import {
  registerManualQuantitativeEntry,
  listManualEntries,
  fetchAvailableGeneralLots
} from '@/lib/manualProductionService';
import {
  canonicalProductionStage,
  fetchProductionStagePolicies,
} from '@/lib/productionStagePolicyService';

const SHIFTS = ['1º Turno', '2º Turno', '3º Turno'];

export default function ManualProductionEntryPage() {
  const { user } = useAuth();
  const { session: operatorSession } = useOperatorSession();

  const [activeCells, setActiveCells] = useState([]);
  const [availableLots, setAvailableLots] = useState([]);
  const [recentEntries, setRecentEntries] = useState([]);

  // Form State — Baixa Manual
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [generalLotCode, setGeneralLotCode] = useState('');
  const [selectedCell, setSelectedCell] = useState('');
  const [shift, setShift] = useState(SHIFTS[0]);
  const [operatorName, setOperatorName] = useState(user?.name || operatorSession?.name || 'Operador Manual');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [submittingBaixa, setSubmittingBaixa] = useState(false);

  // Filtro de busca na tabela
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  // Carrega células ativas e lotes disponíveis
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Células autorizadas para o operador/usuário
      const { data: cellsData } = await supabase.from('cells').select('id, name, type, active').eq('active', true).order('name');
      const allowedCellsObj = getOperatorAllowedCells({ user, opSession: operatorSession, allCells: cellsData || [] });
      const policies = await fetchProductionStagePolicies();
      const manualStages = new Set(
        policies
          .filter((policy) => policy.manual_quantity_allowed)
          .map((policy) => policy.stage_code),
      );
      const cells = allowedCellsObj
        .map(c => c.name)
        .filter((name) => manualStages.has(canonicalProductionStage(name)));
      setActiveCells(cells);
      if (cells.length > 0 && (!selectedCell || !cells.includes(selectedCell))) {
        setSelectedCell(cells[0]);
      }

      // 2. Lotes disponíveis
      const lots = await fetchAvailableGeneralLots(50, { cellName: selectedCell || cells[0] });
      setAvailableLots(lots);

      // 3. Entradas recentes do dia
      const today = new Date().toISOString().slice(0, 10);
      const entries = await listManualEntries({ date: today, limit: 30 });
      setRecentEntries(entries);
    } catch (err) {
      console.error('Erro ao carregar dados da página de baixa manual:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedCell]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Atualiza nome do operador se a sessão mudar
  useEffect(() => {
    const currentName = user?.name || operatorSession?.name || '';
    if (currentName && (!operatorName || operatorName === 'Operador Manual')) {
      setOperatorName(currentName);
    }
  }, [user, operatorSession, operatorName]);

  const selectedLot = availableLots.find((lot) => lot.batchId === selectedBatchId) || null;
  const remainingQuantity = Number(selectedLot?.stageProgress?.remaining_pieces) || 0;

  // Handler: Submeter Baixa Manual
  const handleBaixaSubmit = async (e) => {
    e.preventDefault();
    const cleanLot = String(generalLotCode).trim().toUpperCase();
    const numQty = Number(quantity);

    if (!cleanLot || !selectedBatchId) {
      toast.error('Selecione obrigatoriamente um Lote Geral ativo.');
      return;
    }
    if (!selectedCell) {
      toast.error('Selecione a célula produtiva.');
      return;
    }
    if (!Number.isInteger(numQty) || numQty <= 0) {
      toast.error('A quantidade produzida deve ser um número inteiro maior que zero.');
      return;
    }

    setSubmittingBaixa(true);
    try {
      const result = await registerManualQuantitativeEntry({
        pcp_import_batch_id: selectedBatchId,
        general_lot_code: cleanLot,
        cell_name: selectedCell,
        shift,
        operator: operatorName,
        quantity: numQty,
        unit_of_measure: 'pecas',
        notes,
        date: new Date().toISOString().slice(0, 10),
      });

      if (result.success) {
        if (result.batch_completed) {
          toast.success(`Lote Geral ${cleanLot} encerrado com sucesso.`, {
            description: 'Todas as etapas obrigatórias foram contabilizadas.',
          });
        } else if (result.stage_completed) {
          toast.success(`${selectedCell} concluída para o Lote ${cleanLot}.`, {
            description: 'KPIs, gráficos e fechamento produtivo foram atualizados.',
          });
        } else {
          toast.success(`Volume de ${numQty} peças registrado no Lote ${cleanLot}.`, {
            description: `Saldo da etapa: ${result.remaining_after} peça(s).`,
          });
        }

        setQuantity('');
        setNotes('');
        await loadData();
      }
    } catch (err) {
      toast.error(`Falha ao registrar baixa manual: ${err.message}`);
    } finally {
      setSubmittingBaixa(false);
    }
  };

  const filteredEntries = recentEntries.filter((entry) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const lot = (entry.general_lot_code || entry.production_lots?.general_lot_code || entry.production_lots?.lot_code || '').toLowerCase();
    const cell = (entry.cell_name || '').toLowerCase();
    const op = (entry.operator || '').toLowerCase();
    return lot.includes(term) || cell.includes(term) || op.includes(term);
  });

  const totalPartsToday = recentEntries.reduce((acc, curr) => acc + (Number(curr.quantity) || 0), 0);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Baixas Manuais de Produção"
        subtitle="Baixas quantitativas vinculadas obrigatoriamente a Lotes Gerais ativos, com atualização direta dos KPIs"
        icon={Edit3}
      />

      {/* Cards de Resumo dos KPIs do Dia */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 border-border/60 shadow-sm bg-card rounded-2xl flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium">Lançamentos Manuais Hoje</p>
            <p className="text-2xl font-black text-foreground mt-0.5">{recentEntries.length}</p>
          </div>
          <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-600 dark:text-emerald-400">
            <Edit3 className="w-5 h-5" />
          </div>
        </Card>

        <Card className="p-4 border-border/60 shadow-sm bg-card rounded-2xl flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium">Volume Baixado Manualmente</p>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
              +{totalPartsToday.toLocaleString()} <span className="text-xs font-bold text-muted-foreground">peças</span>
            </p>
          </div>
          <div className="p-3 bg-blue-500/10 rounded-xl text-blue-600 dark:text-blue-400">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </Card>

        <Card className="p-4 border-border/60 shadow-sm bg-card rounded-2xl flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium">Lotes Gerais Disponíveis</p>
            <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-0.5">{availableLots.length}</p>
          </div>
          <div className="p-3 bg-amber-500/10 rounded-xl text-amber-600 dark:text-amber-400">
            <Layers className="w-5 h-5" />
          </div>
        </Card>
      </div>

      {/* Alerta de Proteção da Coleta Física por Scanner */}
      <div className="p-4 rounded-2xl border border-blue-500/30 bg-blue-500/5 text-blue-900 dark:text-blue-200 text-xs flex items-start gap-3 leading-relaxed">
        <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <p className="font-extrabold text-blue-800 dark:text-blue-300">
            🔒 Proteção e Independência da Coleta Óptica por Scanner (RFID / Código de Barras):
          </p>
          <p className="mt-0.5">
            Os cadastros e baixas manuais efetuados nesta página atualizam os gráficos de KPIs e Metas das Células <strong>sem alterar ou interferir nas regras de bipagem física individual por scanner</strong> da estação de Coleta.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 border-border/60 shadow-sm rounded-2xl">
              <CardHeader className="border-b border-border/40 pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                    <Edit3 className="w-4 h-4 text-emerald-500" /> Baixa de Produção por Volume
                  </CardTitle>
                  <Badge variant="outline" className="bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 font-bold gap-1 text-[11px]">
                    ⚡ Atualiza KPIs das Células
                  </Badge>
                </div>
                <CardDescription className="text-xs text-muted-foreground mt-1">
                  Lance o volume produzido de um Lote Geral para contabilização imediata nas Metas e Dashboards.
                </CardDescription>
              </CardHeader>

              <CardContent className="pt-5">
                <form onSubmit={handleBaixaSubmit} className="space-y-4">
                  {/* Lote Geral */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <Hash className="w-3.5 h-3.5 text-primary" /> Código do Lote Geral / PCP
                    </Label>
                    <Select
                      value={selectedBatchId}
                      onValueChange={(batchId) => {
                        const lot = availableLots.find((item) => item.batchId === batchId);
                        setSelectedBatchId(batchId);
                        setGeneralLotCode(lot?.code || '');
                      }}
                    >
                      <SelectTrigger className="rounded-xl h-10 text-xs font-medium bg-background/60">
                        <SelectValue placeholder="Selecione obrigatoriamente um lote ativo..." />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl max-h-56">
                        {availableLots.map((lot) => (
                          <SelectItem key={lot.batchId} value={lot.batchId}>
                            Lote {lot.code} · saldo {Number(lot.stageProgress?.remaining_pieces || 0)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Célula Produtiva e Turno */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-[#2d9c4a]" /> Célula Produtiva Alvo
                      </Label>
                      <Select
                        value={selectedCell}
                        onValueChange={(value) => {
                          setSelectedCell(value);
                          setSelectedBatchId('');
                          setGeneralLotCode('');
                          setQuantity('');
                        }}
                      >
                        <SelectTrigger className="rounded-xl h-10 text-xs font-semibold bg-background/60">
                          <SelectValue placeholder="Selecione a célula" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          {activeCells.map((cell) => (
                            <SelectItem key={cell} value={cell}>{cell}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5 text-blue-500" /> Turno de Trabalho
                      </Label>
                      <Select value={shift} onValueChange={setShift}>
                        <SelectTrigger className="rounded-xl h-10 text-xs font-semibold bg-background/60">
                          <SelectValue placeholder="Selecione o turno" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl">
                          {SHIFTS.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Quantidade e Unidade de Medida */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Volume produzido em peças
                    </Label>
                    <Input
                      type="number"
                      min="1"
                      max={remainingQuantity || undefined}
                      step="1"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      placeholder={selectedLot ? `Máximo ${remainingQuantity}` : 'Selecione o lote'}
                      disabled={!selectedLot}
                      className="rounded-xl h-10 text-xs font-extrabold bg-emerald-500/5 border-emerald-500/30"
                      required
                    />
                  </div>

                  {/* Operador e Observações */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-amber-500" /> Operador / Responsável
                      </Label>
                      <Input
                        value={operatorName}
                        onChange={(e) => setOperatorName(e.target.value)}
                        placeholder="Nome do operador"
                        className="rounded-xl h-10 text-xs font-medium bg-background/60"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-muted-foreground" /> Observações (Opcional)
                      </Label>
                      <Input
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Motivo ou nota do lançamento manual"
                        className="rounded-xl h-10 text-xs font-medium bg-background/60"
                      />
                    </div>
                  </div>

                  {/* Regra de rastreabilidade */}
                  <div className="pt-2">
                    <div className="flex items-start gap-3 text-xs text-blue-900 dark:text-blue-200 bg-blue-500/10 p-3.5 rounded-xl border border-blue-500/30">
                      <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                      <span>
                        A baixa será contabilizada somente em <strong>{selectedCell || 'esta célula'}</strong>.
                        Ela atualiza KPIs e fechamento, mas não cria códigos ou leituras individuais.
                      </span>
                    </div>
                  </div>

                  {/* Botão de Envio */}
                  <div className="pt-3">
                    <Button
                      type="submit"
                      disabled={submittingBaixa || !selectedLot}
                      className="w-full h-11 bg-[#1A2238] hover:bg-[#111728] text-white font-extrabold rounded-xl shadow-md gap-2 text-sm"
                    >
                      <Check className="w-4 h-4" />
                      {submittingBaixa ? 'Registrando Baixa Manual...' : 'Confirmar Baixa Manual e Atualizar KPIs'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* Painel de Apoio das Regras */}
            <div className="space-y-4">
              <Card className="border-amber-500/30 bg-amber-500/5 shadow-sm rounded-2xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-extrabold text-amber-700 dark:text-amber-300 flex items-center gap-2">
                    <Info className="w-4 h-4 text-amber-600" /> Contabilidade protegida por lote e etapa
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-amber-900/80 dark:text-amber-200/80 space-y-2 leading-relaxed">
                  <p>
                    O Lote Geral deve estar ativo e ser escolhido na lista. O sistema limita a baixa ao saldo da etapa:
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px] font-bold">
                    <div className="bg-background/80 p-2 rounded-lg border border-amber-500/20 text-center">Previsto</div>
                    <div className="bg-background/80 p-2 rounded-lg border border-amber-500/20 text-center">Já coletado</div>
                    <div className="bg-background/80 p-2 rounded-lg border border-amber-500/20 text-center">Volume manual</div>
                    <div className="bg-background/80 p-2 rounded-lg border border-amber-500/20 text-center">Saldo restante</div>
                  </div>
                  <p className="text-[11px] pt-1 font-semibold text-amber-800 dark:text-amber-300">
                    Quando o saldo de todas as etapas obrigatórias chegar a zero, o lote é encerrado.
                  </p>
                </CardContent>
              </Card>
            </div>
      </div>

      {/* ── Tabela de Histórico Unificado do Dia ──────────────────────── */}
      <Card className="border-border/60 shadow-sm rounded-2xl overflow-hidden">
        <CardHeader className="border-b border-border/40 pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <RefreshCw className="w-4.5 h-4.5 text-primary" /> Histórico de Entradas e Baixas Manuais do Dia
            </CardTitle>
            <div className="flex items-center gap-2">
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Filtrar lote, célula ou operador..."
                className="h-8 text-xs w-48 sm:w-64 rounded-lg bg-background/60"
              />
              <Button variant="ghost" size="sm" onClick={loadData} className="gap-1.5 text-xs">
                <RefreshCw className="w-3.5 h-3.5" /> Atualizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredEntries.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              {searchTerm ? 'Nenhum lançamento encontrado para a busca informada.' : 'Nenhuma baixa manual quantitativa registrada hoje.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-secondary/40 text-muted-foreground font-bold border-b border-border/40">
                  <tr>
                    <th className="py-2.5 px-4">Horário</th>
                    <th className="py-2.5 px-4">Lote Geral</th>
                    <th className="py-2.5 px-4">Célula</th>
                    <th className="py-2.5 px-4">Turno</th>
                    <th className="py-2.5 px-4">Quantidade</th>
                    <th className="py-2.5 px-4">Operador</th>
                    <th className="py-2.5 px-4">Origem / Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {filteredEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-secondary/20 transition-colors">
                      <td className="py-2.5 px-4 font-medium">
                        {new Date(entry.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-2.5 px-4 font-bold text-foreground">
                        {entry.general_lot_code || entry.production_lots?.general_lot_code || entry.production_lots?.lot_code || '---'}
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-primary">{entry.cell_name || 'PCP'}</td>
                      <td className="py-2.5 px-4">{entry.shift || '1º Turno'}</td>
                      <td className="py-2.5 px-4 font-extrabold text-emerald-600 dark:text-emerald-400">
                        {entry.type === 'entry' ? '' : '+'}{entry.quantity} {entry.unit_of_measure || 'pecas'}
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground">{entry.operator || 'Operador'}</td>
                      <td className="py-2.5 px-4">
                        {entry.type === 'entry' ? (
                          <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 text-[10px] font-bold">
                            📦 Cadastro Lote PCP
                          </Badge>
                        ) : (
                          <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[10px] font-bold">
                            ⚡ Baixa Manual (KPIs OK)
                          </Badge>
                        )}
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
  );
}
