import { Settings2, Eye, EyeOff, Maximize, Minimize } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function DashboardLayoutSettings({ panels, hidden, sizes, toggleHidden, toggleSize }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2 bg-card border-border/80 text-foreground hover:bg-secondary/60 rounded-full shadow-sm">
          <Settings2 className="w-4 h-4" /> Layout
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Configurar Painéis</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-[300px] overflow-y-auto p-1">
          {panels.map((p) => {
            const isHidden = hidden.includes(p.id);
            const isFull = sizes[p.id] !== 'half';
            return (
              <div key={p.id} className="flex items-center justify-between py-2 px-2 hover:bg-muted/50 rounded-md">
                <span className="text-sm font-medium truncate pr-2">{p.title || p.id}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => toggleSize(p.id)}
                    title={isFull ? "Tamanho normal" : "Ocupar largura total"}
                  >
                    {isFull ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => toggleHidden(p.id)}
                    title={isHidden ? "Mostrar painel" : "Ocultar painel"}
                  >
                    {isHidden ? <EyeOff className="w-3.5 h-3.5 text-muted-foreground" /> : <Eye className="w-3.5 h-3.5 text-primary" />}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
