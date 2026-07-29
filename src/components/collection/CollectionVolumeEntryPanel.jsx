import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, CheckCircle2, Loader2, PackageCheck, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  fetchAvailableGeneralLots,
  registerManualQuantitativeEntry,
} from '@/lib/manualProductionService';
import { fetchProductionStagePolicies, canonicalProductionStage } from '@/lib/productionStagePolicyService';
import { invalidateAllMesQueries } from '@/config/queryKeys';

function saoPauloDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export default function CollectionVolumeEntryPanel({
  cellName,
  shift,
  operator,
  disabled = false,
  onSuccess,
}) {
  const queryClient = useQueryClient();
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const stageCode = canonicalProductionStage(cellName);

  const {
    data: policies = [],
    isLoading: loadingPolicies,
  } = useQuery({
    queryKey: ['production-stage-policies'],
    queryFn: fetchProductionStagePolicies,
    staleTime: 60_000,
  });

  const {
    data: lots = [],
    isLoading: loadingLots,
    isError: lotsError,
    refetch: refetchLots,
  } = useQuery({
    queryKey: ['active-general-lots-manual-volume', cellName],
    queryFn: () => fetchAvailableGeneralLots(100, { cellName }),
    enabled: Boolean(cellName),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const policy = policies.find((item) => item.stage_code === stageCode);
  const manualAllowed = policy?.manual_quantity_allowed === true;
  const selectedLot = lots.find((lot) => lot.batchId === selectedBatchId) || null;
  const stageProgress = selectedLot?.stageProgress || null;
  const remaining = Number(stageProgress?.remaining_pieces) || 0;
  const produced = Number(stageProgress?.effective_completed_pieces ?? stageProgress?.completed_pieces) || 0;
  const required = Number(stageProgress?.required_pieces) || 0;

  useEffect(() => {
    setSelectedBatchId('');
    setQuantity('');
  }, [cellName]);

  const canSubmit = useMemo(() => {
    const parsed = Number(quantity);
    return !disabled
      && manualAllowed
      && selectedLot
      && Number.isInteger(parsed)
      && parsed > 0
      && parsed <= remaining
      && !submitting;
  }, [disabled, manualAllowed, selectedLot, quantity, remaining, submitting]);

  const submit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const result = await registerManualQuantitativeEntry({
        pcp_import_batch_id: selectedLot.batchId,
        general_lot_code: selectedLot.code,
        cell_name: cellName,
        shift,
        operator,
        quantity: Number(quantity),
        notes,
        date: saoPauloDate(),
      });

      invalidateAllMesQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ['active-general-lots-manual-volume'] });
      queryClient.invalidateQueries({ queryKey: ['productionDailyGoals'] });
      setQuantity('');
      setNotes('');
      await refetchLots();

      if (result.batch_completed) {
        toast.success(`Lote Geral ${selectedLot.code} concluído.`, {
          description: 'Todas as etapas obrigatórias foram contabilizadas e o lote foi encerrado.',
        });
      } else if (result.stage_completed) {
        toast.success(`${cellName} concluída para o Lote ${selectedLot.code}.`, {
          description: 'O volume foi contabilizado nos KPIs, gráficos e fechamento produtivo.',
        });
      } else {
        toast.success(`Volume de ${result.quantity} peça(s) contabilizado.`, {
          description: `Restam ${result.remaining_after} peça(s) nesta etapa.`,
        });
      }

      onSuccess?.(result);
    } catch (error) {
      toast.error(error?.message || 'Falha ao registrar a baixa por volume.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!cellName) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
        Selecione a célula antes de usar a baixa por volume.
      </div>
    );
  }

  if (!loadingPolicies && !manualAllowed) {
    return (
      <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm text-amber-900 dark:text-amber-200">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-extrabold">Baixa por volume desativada em {cellName}</p>
            <p className="mt-1 text-xs leading-relaxed">
              Use Scanner físico, Câmera ou Código individual. Um gestor pode liberar a baixa por
              volume na configuração da etapa produtiva.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-2xl border-2 border-blue-500/40 bg-blue-500/5 p-4 sm:p-5 space-y-4"
      data-testid="collection-volume-entry"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-blue-600 p-2.5 text-white">
          <Boxes className="h-5 w-5" />
        </div>
        <div>
          <p className="font-extrabold text-foreground">Baixa por volume · {cellName}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Atualiza KPIs, metas, gráficos e fechamento. Como não há código por peça,
            a rastreabilidade será marcada como limitada.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="space-y-1.5">
          <Label htmlFor="collection-volume-lot" className="text-xs font-bold">
            Lote Geral ativo <span className="text-rose-600">*</span>
          </Label>
          <Select value={selectedBatchId} onValueChange={setSelectedBatchId}>
            <SelectTrigger id="collection-volume-lot" className="h-11 rounded-xl bg-background">
              <SelectValue placeholder={loadingLots ? 'Carregando lotes...' : 'Selecione obrigatoriamente o lote'} />
            </SelectTrigger>
            <SelectContent>
              {lots.map((lot) => (
                <SelectItem key={lot.batchId} value={lot.batchId}>
                  Lote {lot.code} · saldo {Number(lot.stageProgress?.remaining_pieces || 0)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!loadingLots && !lotsError && lots.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              Nenhum Lote Geral ativo possui saldo para {cellName}.
            </p>
          )}
          {lotsError && (
            <button type="button" onClick={() => refetchLots()} className="text-[11px] font-bold text-rose-600">
              Falha ao carregar lotes. Clique para tentar novamente.
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="collection-volume-quantity" className="text-xs font-bold">
            Volume produzido <span className="text-rose-600">*</span>
          </Label>
          <Input
            id="collection-volume-quantity"
            type="number"
            inputMode="numeric"
            min="1"
            max={remaining || undefined}
            step="1"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder={selectedLot ? `Máximo ${remaining}` : 'Selecione o lote'}
            disabled={!selectedLot || submitting || disabled}
            className="h-11 rounded-xl bg-background text-base font-extrabold"
          />
        </div>
      </div>

      {selectedLot && (
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-blue-500/20 bg-background/80 p-3 text-center">
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Previsto</p>
            <p className="mt-1 text-lg font-black tabular-nums">{required}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Produzido</p>
            <p className="mt-1 text-lg font-black tabular-nums text-emerald-600">{produced}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase text-muted-foreground">Saldo</p>
            <p className="mt-1 text-lg font-black tabular-nums text-blue-600">{remaining}</p>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="collection-volume-notes" className="text-xs font-bold">
          Observação (opcional)
        </Label>
        <Input
          id="collection-volume-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Ex.: contagem física do fechamento do turno"
          className="h-10 rounded-xl bg-background"
        />
      </div>

      <Button
        type="submit"
        disabled={!canSubmit || loadingPolicies}
        className="h-11 w-full rounded-xl bg-blue-700 font-extrabold text-white hover:bg-blue-800"
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Contabilizando volume...
          </>
        ) : remaining > 0 && Number(quantity) === remaining ? (
          <>
            <PackageCheck className="mr-2 h-4 w-4" />
            Concluir etapa com este volume
          </>
        ) : (
          <>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Contabilizar volume produzido
          </>
        )}
      </Button>
    </form>
  );
}
