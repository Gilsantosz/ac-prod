import { 
  Barcode, RadioTower, ScanLine, Keyboard, 
  CheckCircle2, ChevronRight 
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function TraceabilityPlaceholder({ 
  onSwitchToManual = null,
  onSwitchToCamera = null
}) {
  return (
    <Card className="border border-border/80 shadow-sm bg-card overflow-hidden">
      <CardHeader className="pb-6 border-b border-border/60">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
            <Barcode className="w-5 h-5" />
          </div>
          <div>
            <CardTitle className="text-base font-bold">Coleta Código / RFID</CardTitle>
            <CardDescription className="text-xs">
              Área preparada para coleta por scanner físico, câmera mobile e RFID futuro.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 space-y-6">
        
        {/* Dispositivos Suportados */}
        <div className="grid sm:grid-cols-3 gap-4">
          
          {/* Scanner Físico */}
          <div className="border border-border/70 rounded-xl p-4 bg-secondary/20 flex flex-col justify-between min-h-[140px] hover:border-[#2d9c4a]/50 transition-all group">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Barcode className="w-6 h-6 text-[#2d9c4a] group-hover:scale-110 transition-transform" />
                <Badge variant="outline" className="text-[9px] bg-emerald-500/10 border-emerald-500/30 text-[#2d9c4a]">Ativo</Badge>
              </div>
              <h4 className="text-xs font-bold text-foreground">Scanner USB / Teclado</h4>
              <p className="text-[10px] text-muted-foreground leading-normal">
                Basta focar no campo de digitação e disparar o feixe de laser físico para ler a etiqueta.
              </p>
            </div>
            <Button variant="ghost" size="sm" className="mt-3 text-[10px] h-7 w-full justify-between" onClick={onSwitchToManual}>
              Focar campo de leitura <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </div>

          {/* Câmera Mobile */}
          <div className="border border-border/70 rounded-xl p-4 bg-secondary/20 flex flex-col justify-between min-h-[140px] hover:border-[#2d9c4a]/50 transition-all group">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <ScanLine className="w-6 h-6 text-[#2d9c4a] group-hover:scale-110 transition-transform" />
                <Badge variant="outline" className="text-[9px] bg-emerald-500/10 border-emerald-500/30 text-[#2d9c4a]">Ativo</Badge>
              </div>
              <h4 className="text-xs font-bold text-foreground">Câmera do Celular</h4>
              <p className="text-[10px] text-muted-foreground leading-normal">
                Use a câmera integrada do seu dispositivo móvel ou coletor digital para escanear QR Code/Barcode.
              </p>
            </div>
            <Button variant="ghost" size="sm" className="mt-3 text-[10px] h-7 w-full justify-between" onClick={onSwitchToCamera}>
              Abrir leitor de câmera <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </div>

          {/* RFID Futuro */}
          <div className="border border-border/70 rounded-xl p-4 bg-secondary/20 flex flex-col justify-between min-h-[140px] opacity-75 hover:opacity-100 transition-all group">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <RadioTower className="w-6 h-6 text-sky-500 group-hover:scale-110 transition-transform" />
                <Badge variant="secondary" className="text-[9px] bg-sky-500/10 text-sky-600 border-0">Aguardando Hardware</Badge>
              </div>
              <h4 className="text-xs font-bold text-foreground">Integração RFID</h4>
              <p className="text-[10px] text-muted-foreground leading-normal">
                Preparado para leitura automática em lote por antenas fixas e coletores RFID portáteis.
              </p>
            </div>
            <div className="mt-3 text-[9px] text-muted-foreground italic flex items-center gap-1.5 px-2">
              <CheckCircle2 className="w-3 h-3 text-sky-500" /> Gateway pronto no banco
            </div>
          </div>

        </div>

        {/* Contingência */}
        <div className="bg-secondary/40 border border-border/50 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5 flex-1">
            <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Keyboard className="w-4 h-4 text-amber-500" />
              Contingência Operacional
            </h4>
            <p className="text-[11px] text-muted-foreground leading-normal max-w-xl">
              Em caso de avarias físicas nos leitores, instabilidade na câmera, ou etiquetas rasgadas/ilegíveis, utilize a Entrada Manual para não parar o fluxo produtivo.
            </p>
          </div>
          <Button 
            type="button" 
            variant="outline"
            size="sm" 
            onClick={onSwitchToManual}
            className="text-xs font-semibold shrink-0 gap-1.5 border-amber-300 dark:border-amber-900 bg-amber-50/15 text-amber-700 dark:text-amber-400 hover:bg-amber-50/30"
          >
            <Keyboard className="w-4 h-4" />
            Entrada manual de contingência
          </Button>
        </div>

      </CardContent>
    </Card>
  );
}
