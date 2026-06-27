import { 
  User, Layers, Clock, Calendar, Wifi, WifiOff, DatabaseBackup 
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export default function ProductionContextCard({ 
  user = {}, 
  cellName = '', 
  shift = '', 
  date = '', 
  online = true, 
  pendingCount = 0,
  activeTab = ''
}) {
  const operatorName = user.name || user.email || 'Não Identificado';
  const userCell = user.cell || 'Nenhuma';
  
  // Traduzir abas
  const tabNames = {
    quick: 'Manual Rápido',
    complete: 'Manual Completo',
    collection: 'Coleta Código/RFID',
    history: 'Histórico'
  };
  const modeLabel = tabNames[activeTab] || activeTab || 'Manual';

  return (
    <Card className="border border-border/80 shadow-sm relative overflow-hidden bg-card/90 backdrop-blur-sm">
      <div className="absolute top-0 bottom-0 left-0 w-1.5 bg-gradient-to-b from-[#2d9c4a] via-emerald-400 to-[#2d9c4a]" />
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          {/* Operador e Célula */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-[#76FB91]/15 border border-[#76FB91]/30 flex items-center justify-center shrink-0">
              <User className="w-5 h-5 text-[#2d9c4a]" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Operador Conectado</p>
              <h3 className="font-bold text-base truncate text-foreground leading-snug">{operatorName}</h3>
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" /> 
                Célula Perfil: <span className="font-semibold text-foreground">{userCell}</span>
              </p>
            </div>
          </div>

          {/* Contexto Operacional: Célula Ativa, Turno, Data */}
          <div className="grid grid-cols-2 sm:flex sm:items-center gap-3 lg:gap-6 border-t lg:border-t-0 lg:border-l border-border/60 pt-3 lg:pt-0 lg:pl-6 flex-1">
            <div className="space-y-0.5">
              <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Célula de Apontamento</p>
              <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-[#2d9c4a]" />
                {cellName || 'Não selecionada'}
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Turno Ativo</p>
              <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-[#2d9c4a]" />
                {shift || 'Não selecionado'}
              </p>
            </div>
            <div className="space-y-0.5 col-span-2 sm:col-span-1">
              <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Data do Lançamento</p>
              <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-[#2d9c4a]" />
                {date ? new Date(date + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}
              </p>
            </div>
          </div>

          {/* Status de Conexão e Lançamentos Pendentes */}
          <div className="flex items-center gap-2.5 sm:gap-4 justify-between lg:justify-end border-t lg:border-t-0 pt-3 lg:pt-0 shrink-0">
            {/* Modo de Lançamento */}
            <div className="text-right hidden sm:block">
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Modo</p>
              <Badge variant="outline" className="mt-0.5 text-xs font-semibold bg-secondary/40 border-border">
                {modeLabel}
              </Badge>
            </div>

            {/* Pendentes */}
            {pendingCount > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-600 animate-pulse text-xs font-bold">
                <DatabaseBackup className="w-4 h-4" />
                <span>{pendingCount} Pendente{pendingCount > 1 ? 's' : ''}</span>
              </div>
            )}

            {/* Conexão */}
            <div className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border",
              online 
                ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-400" 
                : "bg-red-500/10 border-red-500/25 text-red-600 dark:text-red-400 animate-pulse"
            )}>
              {online ? (
                <>
                  <Wifi className="w-4 h-4" />
                  <span>Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-4 h-4" />
                  <span>Offline</span>
                </>
              )}
            </div>

          </div>

        </div>
      </CardContent>
    </Card>
  );
}
