import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, Factory, Layers3, PackageCheck, UsersRound, Scale } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  formatDuration,
  formatForecastDate,
  getConfidenceMeta,
  getForecastStatusMeta,
  groupClientLotsByCustomer,
  calculateLotBalance,
} from '@/lib/lotTrackingService';

function ProgressBar({ value = 0, tone = 'bg-primary' }) {
  const normalized = Math.min(100, Math.max(0, Number(value) || 0));
  return (
    <div className="h-2 rounded-full bg-secondary/80 overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${tone}`} style={{ width: `${normalized}%` }} />
    </div>
  );
}

export function StageProgressGrid({ stages = [], compact = false }) {
  const toneByStage = {
    cut: 'bg-emerald-500',
    edge: 'bg-sky-500',
    cnc: 'bg-violet-500',
    joinery: 'bg-amber-500',
  };

  return (
    <div className={`grid gap-3 ${compact ? 'grid-cols-2 xl:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4'}`}>
      {stages.map((stage) => (
        <div key={stage.stage_code} className="rounded-xl border border-border/60 bg-background/70 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-foreground">{stage.stage_label}</span>
            <span className="text-[11px] font-extrabold text-muted-foreground">
              {stage.completed_pieces}/{stage.required_pieces}
            </span>
          </div>
          <ProgressBar value={stage.progress_percent} tone={toneByStage[stage.stage_code]} />
          {!compact && (
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{Number(stage.progress_percent || 0).toFixed(1)}%</span>
              <span>{stage.remaining_pieces > 0 ? `${formatDuration(stage.estimated_remaining_minutes)} restantes` : 'Concluído'}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function GeneralLotSummaryCard({ lot, selected = false, onSelect }) {
  const confidence = getConfidenceMeta(lot.forecast_confidence);
  const status = getForecastStatusMeta(lot.forecast_status);

  return (
    <button type="button" onClick={() => onSelect?.(lot)} className="w-full text-left">
      <Card className={`p-5 border transition-all hover:border-primary/50 hover:shadow-md ${selected ? 'border-primary ring-2 ring-primary/10 bg-primary/[0.025]' : 'border-border/60'}`}>
        <div className="flex flex-col lg:flex-row lg:items-center gap-5">
          <div className="lg:w-52 shrink-0">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              <Layers3 className="w-4 h-4 text-primary" /> Lote geral
            </div>
            <p className="mt-1 text-3xl font-black tracking-tight text-foreground">{lot.general_lot_code || 'Sem código'}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="outline" className={`text-[10px] ${status.className}`}>{status.label}</Badge>
              <Badge variant="outline" className={`text-[10px] ${confidence.className}`}>{confidence.label}</Badge>
            </div>
          </div>

          <div className="flex-1 space-y-3">
            <div className="flex items-center justify-between gap-4 text-xs">
              <span className="font-semibold text-muted-foreground">Andamento até ficar pronto para separação</span>
              <strong className="text-foreground">{Number(lot.progress_percent || 0).toFixed(1)}%</strong>
            </div>
            <ProgressBar value={lot.progress_percent} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div><span className="block text-muted-foreground">Peças</span><strong>{lot.total_pieces || 0}</strong></div>
              <div><span className="block text-muted-foreground">Lotes de clientes</span><strong>{lot.client_lots_count || 0}</strong></div>
              <div><span className="block text-muted-foreground">Prontas p/ separação</span><strong>{lot.ready_for_separation_pieces || 0}</strong></div>
              <div><span className="block text-muted-foreground">Gargalo previsto</span><strong>{lot.bottleneck_stage || 'Sem dados'}</strong></div>
            </div>
          </div>

          <div className="lg:w-56 rounded-2xl border border-border/60 bg-secondary/25 p-4 shrink-0">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase text-muted-foreground">
              <CalendarClock className="w-4 h-4 text-primary" /> Previsão média
            </div>
            <p className="mt-2 text-lg font-extrabold text-foreground">{formatForecastDate(lot.predicted_ready_at)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{formatDuration(lot.estimated_remaining_minutes)} até a separação</p>
          </div>

          <ChevronRight className={`hidden lg:block w-5 h-5 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
        </div>
      </Card>
    </button>
  );
}

export function ClientLotHierarchy({ clientLots = [], selectedLotId, onSelect, renderDetailPanel }) {
  const grouped = groupClientLotsByCustomer(clientLots);

  if (!clientLots.length) {
    return (
      <Card className="p-8 border-dashed text-center text-sm text-muted-foreground">
        Nenhum lote de cliente foi vinculado a este lote geral.
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([customerName, lots]) => (
        <Card key={customerName} className="overflow-hidden border-border/60">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-violet-500/[0.06] border-b border-violet-500/10 px-4 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <UsersRound className="w-4 h-4 text-violet-600 shrink-0" />
              <span className="text-xs font-extrabold text-violet-700 truncate" title={customerName}>{customerName}</span>
            </div>
            <Badge variant="outline" className="w-fit border-violet-500/20 text-violet-700 bg-background/60 text-[10px]">
              {lots.length} {lots.length === 1 ? 'lote na mesma capa' : 'lotes na mesma capa'}
            </Badge>
          </div>

          <div className="divide-y divide-border/50">
            {lots.map((lot) => {
              const selected = selectedLotId === lot.lot_id;
              const status = getForecastStatusMeta(lot.forecast_status);
              const problems = Number(lot.blocked_pieces || 0) + Number(lot.rework_pieces || 0) + Number(lot.replacement_pieces || 0);
              const balance = calculateLotBalance(lot);

              return (
                <div key={lot.lot_id} id={`client-lot-card-${lot.lot_id}`} className="transition-all">
                  <button
                    type="button"
                    onClick={() => onSelect?.(lot)}
                    className={`w-full text-left p-4 transition-colors ${selected ? 'bg-primary/[0.055]' : 'hover:bg-secondary/30'}`}
                  >
                    <div className="flex flex-col xl:flex-row xl:items-center gap-4">
                      <div className="xl:w-40 shrink-0">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground">Lote do cliente</span>
                        <p className="text-xl font-black text-foreground">{lot.lot_code}</p>
                        <Badge variant="outline" className={`mt-1 text-[9px] ${status.className}`}>{status.label}</Badge>
                      </div>

                      <div className="flex-1 min-w-0">
                        <StageProgressGrid stages={lot.stages} compact />
                      </div>

                      <div className="grid grid-cols-2 gap-3 xl:w-72 text-xs shrink-0">
                        <div className="rounded-xl bg-secondary/35 p-3">
                          <span className="flex items-center gap-1 text-muted-foreground"><Factory className="w-3.5 h-3.5" /> Andamento</span>
                          <strong className="block mt-1">{Number(lot.progress_percent || 0).toFixed(1)}%</strong>
                        </div>
                        <div className="rounded-xl bg-secondary/35 p-3">
                          <span className="flex items-center gap-1 text-muted-foreground"><PackageCheck className="w-3.5 h-3.5" /> Peças</span>
                          <strong className="block mt-1">{lot.ready_for_separation_pieces || 0}/{lot.total_pieces || 0}</strong>
                        </div>
                        <div className="col-span-2 flex flex-col gap-1.5 rounded-xl bg-secondary/35 p-3">
                          <div className="flex items-center justify-between w-full">
                            <span className="text-muted-foreground">Previsão: {formatForecastDate(lot.predicted_ready_at)}</span>
                            {problems > 0 ? (
                              <span className="flex items-center gap-1 font-bold text-rose-600"><AlertTriangle className="w-3.5 h-3.5" /> {problems}</span>
                            ) : (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            )}
                          </div>
                          <div className="flex items-center justify-between w-full pt-1.5 border-t border-border/20">
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <Scale className="w-3.5 h-3.5 text-primary" /> Equilíbrio
                            </span>
                            <span className={`font-bold ${balance >= 75 ? 'text-emerald-600' : balance >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>
                              {balance}%
                            </span>
                          </div>
                        </div>
                      </div>
                      <ChevronRight className={`hidden xl:block w-5 h-5 transition-transform duration-200 ${selected ? 'rotate-90 text-primary' : 'text-muted-foreground'}`} />
                    </div>
                  </button>

                  {selected && renderDetailPanel && (
                    <div id={`client-lot-detail-${lot.lot_id}`} className="p-4 sm:p-6 bg-secondary/15 border-t border-primary/20 shadow-inner rounded-b-2xl space-y-6">
                      {renderDetailPanel(lot)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

