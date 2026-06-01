import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, Pause, ChevronLeft, ChevronRight } from 'lucide-react';

// Controla qual célula é exibida no quiosque e a rotação automática entre elas.
export default function KioskCellControl({ cells, active, setActive, rotating, setRotating, intervalSec = 12 }) {
  const timer = useRef(null);

  useEffect(() => {
    if (!rotating || cells.length < 2) return;
    timer.current = setInterval(() => {
      setActive((cur) => {
        const idx = cells.indexOf(cur);
        return cells[(idx + 1) % cells.length];
      });
    }, intervalSec * 1000);
    return () => clearInterval(timer.current);
  }, [rotating, cells, intervalSec, setActive]);

  const step = (dir) => {
    const idx = cells.indexOf(active);
    const next = (idx + dir + cells.length) % cells.length;
    setActive(cells[next]);
  };

  if (!cells.length) return null;

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon" onClick={() => step(-1)} title="Célula anterior">
        <ChevronLeft className="w-4 h-4" />
      </Button>
      <Select value={active} onValueChange={setActive}>
        <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {cells.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button variant="outline" size="icon" onClick={() => step(1)} title="Próxima célula">
        <ChevronRight className="w-4 h-4" />
      </Button>
      <Button
        variant={rotating ? 'default' : 'outline'}
        className="gap-2"
        onClick={() => setRotating((r) => !r)}
        title="Rotação automática entre células"
      >
        {rotating ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        {rotating ? 'Rotacionando' : 'Rotação'}
      </Button>
    </div>
  );
}