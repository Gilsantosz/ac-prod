export default function CollectionLotBanner({ generalLot, clientLotCode, customerName, focus = false }) {
  const progress = generalLot?.progress_percent;
  const progressKnown = progress != null && Number.isFinite(Number(progress));
  return (
    <section
      data-testid="collection-lot-banner"
      className={`rounded-2xl border-2 border-emerald-600 bg-gradient-to-r from-emerald-950 via-emerald-900 to-emerald-800 px-5 py-4 text-white shadow-lg ${focus ? 'sm:p-6' : ''}`}
    >
      <div className="grid gap-4 sm:grid-cols-[1.2fr_1fr_auto] sm:items-center">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-emerald-200">Lote Geral</p>
          <p className="mt-1 break-all font-mono text-3xl font-black leading-tight sm:text-4xl">
            {generalLot?.general_lot_code || 'Aguardando identificação'}
          </p>
        </div>
        <div className="border-emerald-500/40 sm:border-l sm:pl-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-200">Lote do Cliente</p>
          <p className="mt-1 break-all font-mono text-2xl font-extrabold">{clientLotCode || 'Aguardando leitura'}</p>
          {customerName && <p className="mt-1 text-xs font-medium text-emerald-100">{customerName}</p>}
        </div>
        <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 sm:text-right">
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-100">Andamento Geral</p>
          <p className="mt-1 text-2xl font-black tabular-nums">
            {progressKnown ? `${Number(progress).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—'}
          </p>
        </div>
      </div>
    </section>
  );
}
