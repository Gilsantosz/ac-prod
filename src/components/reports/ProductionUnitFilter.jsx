export default function ProductionUnitFilter({ units, value, onChange }) {
  if (!units.length) return null;
  return <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Unidade dos indicadores e gráficos">
    <span className="text-xs font-medium text-muted-foreground mr-2">Unidade</span>
    {units.map((unit) => <button type="button" key={unit.key} aria-pressed={unit.key === value} onClick={() => onChange(unit.key)} className={`rounded-full border px-4 py-2 text-sm capitalize ${unit.key === value ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border text-muted-foreground'}`}>{unit.unitLabel}</button>)}
  </div>;
}
