import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Edit3, Save, CheckCircle2, RefreshCw, Hash, User, FileText, Info, Building2 } from 'lucide-react';
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
import { registerManualQuantitativeEntry, listManualEntries, fetchAvailableGeneralLots } from '@/lib/manualProductionService';

const SHIFTS = ['1º Turno', '2º Turno', '3º Turno'];
const UNITS = [
  { value: 'pecas', label: 'Peças (un)' },
  { value: 'metros', label: 'Metros lineares (m)' },
  { value: 'm2', label: 'Metro quadrado (m²)' },
  { value: 'chapas', label: 'Chapas / Painéis' },
  { value: 'ambientes', label: 'Ambientes' },
];

export default function ManualProductionEntryPage() {
  const { user } = useAuth();
  const { session: operatorSession } = useOperatorSession();

  const [activeCells, setActiveCells] = useState([]);
  const [availableLots, setAvailableLots] = useState([]);
  const [recentEntries, setRecentEntries] = useState([]);

  // Form State
  const [generalLotCode, setGeneralLotCode] = useState('');
  const [selectedCell, setSelectedCell] = useState('');
  const [shift, setShift] = useState(SHIFTS[0]);
  const [operatorName, setOperatorName] = useState(user?.name || operatorSession?.name || 'Operador Manual');
  const [quantity, setQuantity] = useState('');
  const [unitOfMeasure, setUnitOfMeasure] = useState('pecas');
  const [notes, setNotes] = useState('');
  const [cascadeAllCells, setCascadeAllCells] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  // Carrega células ativas e lotes disponíveis
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Células
      const { data: cellsData } = await supabase.from('cells').select('name').eq('active', true).order('name');
      const cells = (cellsData || []).map(c => c.name);
      setActiveCells(cells);
      if (cells.length > 0 && !selectedCell) setSelectedCell(cells[0]);

      // 2. Lotes
      const lots = await fetchAvailableGeneralLots(50);
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanLot = String(generalLotCode).trim().toUpperCase();
    const numQty = Math.max(1, Number(quantity) || 0);

    if (!cleanLot) {
      toast.error('Informe ou selecione um Lote Geral.');
      return;
    }
    if (!selectedCell) {
      toast.error('Selecione a célula produtiva.');
      return;
    }
    if (numQty <= 0) {
      toast.error('A quantidade produzida deve ser maior que zero.');
      return;
    }

    setSubmitting(true);
    try {
      const isEmbalagem = String(selectedCell).toLowerCase() === 'embalagem';
      const shouldCascade = cascadeAllCells || isEmbalagem;
      const result = await registerManualQuantitativeEntry({
        general_lot_code: cleanLot,
        cell_name: selectedCell,
        shift,
        operator: operatorName,
        quantity: numQty,
        unit_of_measure: unitOfMeasure,
        cascade_all_cells: shouldCascade,
        notes,
        date: new Date().toISOString().slice(0, 10),
      });

      if (result.success) {
        if (result.cascade) {
          toast.success(`Baixa automática em cascata registrada nas 4 células (Corte, Bordo, Usinagem, Embalagem)!`, {
            description: `Lote ${cleanLot}: ${numQty} ${unitOfMeasure} contabilizados para metas diárias.`,
          });
        } else {
          toast.success(`Baixa manual de ${numQty} ${unitOfMeasure} registrada no Lote ${cleanLot}!`, {
            description: `Célula: ${selectedCell} | Turno: ${shift}`,
          });
        }

        // Limpa campos mantendo lote e célula para lançamentos contínuos
        setQuantity('');
        setNotes('');
        await loadData();
      }
    } catch (err) {
      toast.error(`Falha ao registrar baixa manual: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title="Baixa Produtiva Manual Quantitativa"
        subtitle="Lançamento direto de volume produzido por Lote Geral e Célula com rastreabilidade simplificada"
        icon={Edit3}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Formulário Principal de Baixa Manual ────────────────────── */}
        <Card className="lg:col-span-2 border-border/60 shadow-sm rounded-2xl">
          <CardHeader className="border-b border-border/40 pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-emerald-500" /> Registrar Lançamento Manual
              </CardTitle>
              <Badge variant="outline" className="bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 font-bold gap-1 text-[11px]">
                ✋ Rastreabilidade Simplificada
              </Badge>
            </div>
            <CardDescription className="text-xs text-muted-foreground mt-1">
              Preencha os dados do volume produzido para contabilização imediata nos KPIs e Metas da Célula.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-5">
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Lote Geral */}
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-primary" /> Lote Geral / PCP
                </Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    value={generalLotCode}
                    onChange={(e) => setGeneralLotCode(e.target.value.toUpperCase())}
                    placeholder="Ex: LOT-2026-001"
                    className="rounded-xl h-10 uppercase text-xs font-bold bg-background/60"
                    required
                  />
                  {availableLots.length > 0 && (
                    <Select
                      value={generalLotCode}
                      onValueChange={(val) => setGeneralLotCode(val)}
                    >
                      <SelectTrigger className="rounded-xl h-10 text-xs font-medium bg-background/60">
                        <SelectValue placeholder="Ou escolha um lote existente..." />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl max-h-56">
                        {availableLots.map((lot) => (
                          <SelectItem key={lot.code} value={lot.code}>
                            {lot.code} ({lot.totalItems} itens)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              {/* Célula Produtiva */}
              <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-[#2d9c4a]" /> Célula Produtiva
                  </Label>
                  <Select value={selectedCell} onValueChange={setSelectedCell}>
                    <SelectTrigger className="rounded-xl h-10 text-xs font-semibold bg-background/60">
                      <SelectValue placeholder="Selecione a célula (Corte, Bordo, Usinagem, Embalagem)" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      {activeCells.map((cell) => (
                        <SelectItem key={cell} value={cell}>{cell}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
              </div>

              {/* Quantidade */}
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Quantidade Produzida
                </Label>
                <Input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
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

              {/* Opção de Baixa Automática em Cascata */}
              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-foreground bg-secondary/30 p-3 rounded-xl border border-border/50 select-none">
                  <input
                    type="checkbox"
                    checked={cascadeAllCells || String(selectedCell).toLowerCase() === 'embalagem'}
                    onChange={(e) => setCascadeAllCells(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>⚡ Propagar baixa automática nas 4 células (Corte, Bordo, Usinagem e Embalagem) para metas diárias</span>
                </label>
              </div>

              {/* Botão de Envio */}
              <div className="pt-3">
                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-11 bg-[#1A2238] hover:bg-[#111728] text-white font-extrabold rounded-xl shadow-md gap-2 text-sm"
                >
                  <Save className="w-4 h-4" />
                  {submitting ? 'Registrando Baixa Manual...' : 'Confirmar Baixa Produtiva Manual'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* ── Painel de Informação & Alertas ───────────────────────── */}
        <div className="space-y-4">
          <Card className="border-amber-500/30 bg-amber-500/5 shadow-sm rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-extrabold text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <Info className="w-4 h-4 text-amber-600" /> Rastreabilidade e Auditoria
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-amber-900/80 dark:text-amber-200/80 space-y-2 leading-relaxed">
              <p>
                <strong>Entradas Manuais Quantitativas</strong> registram volume direto para meta da célula quando a leitura óptica/scanner não for utilizada.
              </p>
              <ul className="list-disc pl-4 space-y-1 text-[11px]">
                <li><strong>Coleta Física:</strong> Rastreabilidade total peça a peça via scanner.</li>
                <li><strong>Entrada Manual:</strong> Rastreabilidade simplificada agregada ao Lote Geral.</li>
              </ul>
              <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                Ambas as entradas contabilizam no cálculo de atingimento de metas da célula e do turno.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Tabela de Lançamentos Manuais Recentes do Dia ───────────── */}
      <Card className="border-border/60 shadow-sm rounded-2xl overflow-hidden">
        <CardHeader className="border-b border-border/40 pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <RefreshCw className="w-4.5 h-4.5 text-primary" /> Histórico de Lançamentos Manuais do Dia
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={loadData} className="gap-1.5 text-xs">
              <RefreshCw className="w-3.5 h-3.5" /> Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {recentEntries.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              Nenhuma baixa manual quantitativa registrada hoje.
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
                    <th className="py-2.5 px-4">Origem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {recentEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-secondary/20 transition-colors">
                      <td className="py-2.5 px-4 font-medium">
                        {new Date(entry.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-2.5 px-4 font-bold text-foreground">
                        {entry.general_lot_code || entry.production_lots?.general_lot_code || entry.production_lots?.lot_code || '---'}
                      </td>
                      <td className="py-2.5 px-4 font-semibold text-primary">{entry.cell_name}</td>
                      <td className="py-2.5 px-4">{entry.shift}</td>
                      <td className="py-2.5 px-4 font-extrabold text-emerald-600 dark:text-emerald-400">
                        +{entry.quantity} {entry.unit_of_measure || 'pecas'}
                      </td>
                      <td className="py-2.5 px-4 text-muted-foreground">{entry.operator || 'Operador'}</td>
                      <td className="py-2.5 px-4">
                        <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[10px] font-bold">
                          ✋ Manual Quantitativo
                        </Badge>
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
