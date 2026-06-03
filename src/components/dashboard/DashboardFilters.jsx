import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Calendar } from 'lucide-react';

export default function DashboardFilters({ filters, setFilters, cells }) {
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 w-full sm:w-auto">
      <div className="flex items-center gap-2 bg-white/10 border border-white/20 rounded-xl px-3 py-2 w-full sm:w-auto shrink-0">
        <Calendar className="w-4 h-4 text-white/70 shrink-0" />
        <Input 
          type="date" 
          value={filters.date} 
          onChange={(e) => set('date', e.target.value)} 
          className="border-0 p-0 h-auto w-full sm:w-36 focus-visible:ring-0 text-white bg-transparent font-medium [color-scheme:dark]" 
        />
      </div>

      <div className="w-full sm:w-40 shrink-0">
        <Select value={filters.shift} onValueChange={(v) => set('shift', v)}>
          <SelectTrigger className="w-full bg-white/10 border-white/20 text-white hover:bg-white/20 focus:ring-0 focus:ring-offset-0">
            <SelectValue placeholder="Turno" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os turnos</SelectItem>
            <SelectItem value="1º Turno">1º Turno</SelectItem>
            <SelectItem value="2º Turno">2º Turno</SelectItem>
            <SelectItem value="3º Turno">3º Turno</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="w-full sm:w-44 shrink-0">
        <Select value={filters.cell} onValueChange={(v) => set('cell', v)}>
          <SelectTrigger className="w-full bg-white/10 border-white/20 text-white hover:bg-white/20 focus:ring-0 focus:ring-offset-0">
            <SelectValue placeholder="Célula" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as células</SelectItem>
            {cells.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}