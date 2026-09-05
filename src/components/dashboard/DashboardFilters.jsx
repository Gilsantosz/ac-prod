import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Calendar, CalendarRange } from 'lucide-react';
import { ANNUAL_FILTER_DISABLED, isAnnualFilterActive } from '@/lib/dashboardPeriod';

export default function DashboardFilters({ filters, setFilters, cells, years = [] }) {
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const annualMode = isAnnualFilterActive(filters.year);

  return (
    <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 w-full sm:w-auto">
      {years.length > 0 && (
        <div className={`w-full sm:w-56 shrink-0 rounded-full shadow-sm ${annualMode ? 'ring-2 ring-sky-500/30' : ''}`}>
          <Select value={filters.year || ANNUAL_FILTER_DISABLED} onValueChange={(v) => set('year', v)}>
            <SelectTrigger
              aria-label="Filtro de ano"
              className="w-full bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-full focus:ring-0 focus:ring-offset-0 px-4"
            >
              <CalendarRange className={`mr-2 h-4 w-4 shrink-0 ${annualMode ? 'text-sky-600' : 'text-muted-foreground'}`} />
              <SelectValue placeholder="Filtro anual" />
            </SelectTrigger>
            <SelectContent className="rounded-2xl">
              <SelectItem value={ANNUAL_FILTER_DISABLED}>Sem filtro anual</SelectItem>
              {years.map((year) => (
                <SelectItem key={year} value={year}>Resumo anual · {year}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Seletor de Data em Cápsula */}
      <div
        className={`flex items-center gap-2 bg-card border border-border/80 rounded-full px-4 py-2 w-full sm:w-auto shrink-0 shadow-sm ${annualMode ? 'opacity-50' : ''}`}
        title={annualMode ? 'Desative o filtro anual para selecionar uma data' : 'Selecionar data'}
      >
        <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
        <Input 
          aria-label="Data do painel"
          type="date" 
          value={filters.date} 
          onChange={(e) => { if (e.target.value) set('date', e.target.value); }}
          disabled={annualMode}
          className="border-0 p-0 h-auto w-full sm:w-36 focus-visible:ring-0 text-foreground bg-transparent font-medium focus:outline-none [color-scheme:light] dark:[color-scheme:dark]" 
        />
      </div>

      {/* Seletor de Turno em Cápsula */}
      <div className="w-full sm:w-44 shrink-0">
        <Select value={filters.shift} onValueChange={(v) => set('shift', v)}>
          <SelectTrigger aria-label="Turno do painel" className="w-full bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-full focus:ring-0 focus:ring-offset-0 shadow-sm px-4">
            <SelectValue placeholder="Turno" />
          </SelectTrigger>
          <SelectContent className="rounded-2xl">
            <SelectItem value="all">Todos os turnos</SelectItem>
            <SelectItem value="1º Turno">1º Turno</SelectItem>
            <SelectItem value="2º Turno">2º Turno</SelectItem>
            <SelectItem value="3º Turno">3º Turno</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Seletor de Célula em Cápsula */}
      <div className="w-full sm:w-48 shrink-0">
        <Select value={filters.cell} onValueChange={(v) => set('cell', v)}>
          <SelectTrigger aria-label="Célula do painel" className="w-full bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-full focus:ring-0 focus:ring-offset-0 shadow-sm px-4">
            <SelectValue placeholder="Célula" />
          </SelectTrigger>
          <SelectContent className="rounded-2xl">
            <SelectItem value="all">Todas as células</SelectItem>
            {cells.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
