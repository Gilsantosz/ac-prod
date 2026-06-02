import { useState, useMemo, useRef } from 'react';
import { base44 } from '@/lib/localDb';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useCells } from '@/hooks/useCells';
import { Button } from '@/components/ui/button';
import OccurrenceForm from '@/components/occurrences/OccurrenceForm';
import ParetoChart from '@/components/occurrences/ParetoChart';
import RecentOccurrences from '@/components/occurrences/RecentOccurrences';
import ExportOccurrencesButton from '@/components/occurrences/ExportOccurrencesButton';

export default function Occurrences() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const chartRef = useRef(null);

  // Filtros de visualização e exportação
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [cell, setCell] = useState('all');
  const [shift, setShift] = useState('all');

  const { activeCells } = useCells();
  const cellsList = useMemo(() => activeCells.map((c) => c.name), [activeCells]);

  const { data: occurrences = [] } = useQuery({
    queryKey: ['occurrences'],
    queryFn: () => base44.entities.Occurrence.list('-created_date', 500),
    initialData: [],
  });

  // Filtra as ocorrências dinamicamente para os componentes da tela
  const filteredOccurrences = useMemo(() => {
    return occurrences.filter((o) => {
      if (date && o.date !== date) return false;
      if (cell !== 'all' && o.cell !== cell) return false;
      if (shift !== 'all' && o.shift !== shift) return false;
      return true;
    });
  }, [occurrences, date, cell, shift]);

  const create = useMutation({
    mutationFn: (payload) => base44.entities.Occurrence.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['occurrences'] });
      toast.success('Ocorrência registrada');
    },
    onError: () => toast.error('Falha ao registrar ocorrência'),
  });

  const remove = useMutation({
    mutationFn: (id) => base44.entities.Occurrence.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['occurrences'] });
      toast.success('Ocorrência removida');
    },
  });

  const handleSubmit = async (payload) => {
    setSaving(true);
    // Auto preenche a data atual se não informada pelo formulário
    await create.mutateAsync({
      date: date,
      ...payload
    });
    setSaving(false);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div className="bg-card/40 backdrop-blur-md border border-border/40 p-5 rounded-2xl shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 hover:shadow-md transition-all duration-300">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground bg-gradient-to-r from-foreground via-foreground/90 to-foreground/80 bg-clip-text">Ocorrências e Paradas</h1>
          <p className="text-muted-foreground text-sm mt-1">Registre paradas não planejadas e priorize melhorias com o gráfico de Pareto.</p>
        </div>
      </div>

      {/* Painel Coesivo de Filtros Industriais */}
      <div className="flex flex-col sm:flex-row sm:items-end flex-wrap gap-4 sm:gap-6 bg-card p-4 sm:p-5 rounded-2xl border border-border/60 shadow-sm w-full">
        <div className="space-y-1.5 w-full sm:w-auto">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dia das Ocorrências</span>
          <input 
            type="date" 
            value={date} 
            onChange={(e) => setDate(e.target.value)} 
            className="flex h-9 w-full sm:w-[160px] rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        <div className="space-y-1.5 w-full sm:w-auto max-w-full overflow-hidden">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Filtrar por Célula</span>
          <div className="flex gap-1 bg-muted p-1 rounded-lg border border-border/40 overflow-x-auto max-w-full scrollbar-none whitespace-nowrap">
            <Button 
              variant={cell === 'all' ? 'default' : 'ghost'} 
              size="sm" 
              onClick={() => setCell('all')}
              className="h-7 text-xs rounded-md px-3 font-medium transition-all shrink-0"
            >
              Todas
            </Button>
            {cellsList.map((c) => (
              <Button 
                key={c}
                variant={cell === c ? 'default' : 'ghost'} 
                size="sm" 
                onClick={() => setCell(c)}
                className="h-7 text-xs rounded-md px-3 font-medium transition-all shrink-0"
              >
                {c}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5 w-full sm:w-auto max-w-full overflow-hidden">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Filtrar por Turno</span>
          <div className="flex gap-1 bg-muted p-1 rounded-lg border border-border/40 overflow-x-auto max-w-full scrollbar-none whitespace-nowrap">
            <Button 
              variant={shift === 'all' ? 'default' : 'ghost'} 
              size="sm" 
              onClick={() => setShift('all')}
              className="h-7 text-xs rounded-md px-3 font-medium transition-all shrink-0"
            >
              Todos
            </Button>
            {['1º Turno', '2º Turno', '3º Turno'].map((s) => (
              <Button 
                key={s}
                variant={shift === s ? 'default' : 'ghost'} 
                size="sm" 
                onClick={() => setShift(s)}
                className="h-7 text-xs rounded-md px-3 font-medium transition-all shrink-0"
              >
                {s}
              </Button>
            ))}
          </div>
        </div>
        
        <div className="w-full sm:w-auto sm:ml-auto flex justify-end">
          <ExportOccurrencesButton 
            occurrences={occurrences} 
            date={date} 
            cell={cell} 
            shift={shift} 
            chartEl={chartRef.current} 
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-1">
          <OccurrenceForm onSubmit={handleSubmit} saving={saving} />
        </div>
        <div ref={chartRef} className="xl:col-span-2">
          <ParetoChart occurrences={filteredOccurrences} />
        </div>
      </div>

      <RecentOccurrences occurrences={filteredOccurrences} onDelete={(id) => remove.mutate(id)} />
    </div>
  );
}