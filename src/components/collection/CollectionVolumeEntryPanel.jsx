import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp,
  Boxes,
  CheckCircle2,
  Loader2,
  PackageCheck,
  ShieldAlert,
} from 'lucide-react';
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
  disabledReason = '',
  onSuccess,
}) {
  const queryClient = useQueryClient();
  const quantityInputRef = useRef(null);
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

  useEffect(() => {
    if (!selectedBatchId || disabled) return;
    quantityInputRef.current?.focus();
  }, [disabled, selectedBatchId]);

  const numericObservationWithoutQuantity = useMemo(() => (
    quantity === '' && /^\s*\d+\s*$/.test(notes)
  ), [notes, quantity]);

  const quantityHelp = useMemo(() => {
    if (!selectedLot) return 'Primeiro selecione o Lote Geral ativo.';
    if (disabled) return disabledReason || 'A baixa por volume está temporariamente bloqueada.';
    if (quantity === '') return `Digite a quantidade produzida entre 1 e ${remaining}.`;

    const parsed = Number(quantity);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return 'Informe uma quantidade inteira maior que zero.';
    }
    if (parsed > remaining) {
      return `A quantidade não pode ultrapassar o saldo de ${remaining}.`;
    }
    return `${parsed} peça(s) serão contabilizadas em ${cellName}.`;
  }, [cellName, disabled, disabledReason, quantity, remaining, selectedLot]);

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

      {disabled && (
        <div
          className="rounded-xl border border-amber-400 bg-amber-50 p-3 text-xs font-bold text-amber-900"
          role="alert"
        >
          {disabledReason || 'A baixa por volume está bloqueada enquanto houver uma parada operacional ativa.'}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="space-y-1.5">
          <Label htmlFor="collection-volume-lot" className="text-xs font-bold">
            Lote Geral ativo <span className="text-rose-600">*</span>
          </Label>
          <Select
            value={selectedBatchId}
            onValueChange={(value) => {
              setSelectedBatchId(value);
              setQuantity('');
            }}
            disabled={submitting || disabled}
          >
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

        <div className="space-y-2">
          <div className="flex items-end justify-between gap-2">
            <Label htmlFor="collection-volume-quantity" className="text-sm font-black text-blue-950 dark:text-blue-100">
              Digite o volume produzido <span className="text-rose-600">*</span>
            </Label>
            {selectedLot && remaining > 0 && !disabled && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuantity(String(remaining));
                  quantityInputRef.current?.focus();
                }}
                className="h-8 rounded-lg border-blue-500/50 px-2.5 text-[11px] font-extrabold text-blue-700"
              >
                Usar saldo {remaining}
              </Button>
            )}
          </div>
          <Input
            ref={quantityInputRef}
            id="collection-volume-quantity"
            data-testid="collection-volume-quantity"
            type="number"
            inputMode="numeric"
            min="1"
            max={remaining || undefined}
            step="1"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            placeholder={selectedLot ? `Digite de 1 a ${remaining}` : 'Selecione o lote'}
            disabled={!selectedLot || submitting || disabled}
            aria-describedby="collection-volume-quantity-help"
            className="h-14 rounded-xl border-2 border-blue-600 bg-white px-4 text-xl font-black text-slate-950 shadow-sm placeholder:text-sm placeholder:font-bold focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-slate-950 dark:text-white"
          />
          <p
            id="collection-volume-quantity-help"
            className={`text-[11px] font-bold ${
              quantity !== '' && !canSubmit ? 'text-rose-600' : 'text-blue-700 dark:text-blue-300'
            }`}
          >
            {quantityHelp}
          </p>
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
          Observação em texto (opcional)
        </Label>
        <Input
          id="collection-volume-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Não digite a quantidade aqui. Ex.: fechamento do turno"
          disabled={!selectedLot || submitting || disabled}
          className="h-10 rounded-xl bg-background"
        />
      </div>

      {numericObservationWithoutQuantity && selectedLot && !disabled && (
        <div
          className="flex flex-col gap-3 rounded-xl border-2 border-rose-400 bg-rose-50 p-3 text-sm text-rose-950 sm:flex-row sm:items-center sm:justify-between"
          role="alert"
        >
          <p className="font-bold">
            O número {notes.trim()} foi digitado em Observação. A quantidade deve ficar em Volume produzido.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setQuantity(notes.trim());
              setNotes('');
              quantityInputRef.current?.focus();
            }}
            className="shrink-0 border-rose-500 bg-white font-extrabold text-rose-700 hover:bg-rose-100"
          >
            <ArrowUp className="mr-2 h-4 w-4" />
            Mover para volume
          </Button>
        </div>
      )}

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
      {!canSubmit && !submitting && (
        <p className="text-center text-[11px] font-bold text-muted-foreground">
          {disabled
            ? 'Finalize a parada ativa para liberar a contabilização.'
            : 'O botão será liberado após selecionar o lote e preencher corretamente o volume produzido.'}
        </p>
      )}
    </form>
  );
}
