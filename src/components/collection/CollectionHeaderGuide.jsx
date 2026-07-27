import { useState } from 'react';
import { 
  Info, 
  ScanLine, 
  CheckCircle2, 
  AlertTriangle, 
  Cpu, 
  ChevronDown, 
  ChevronUp, 
  HelpCircle,
  Zap,
  RotateCcw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/**
 * CollectionHeaderGuide
 * 
 * Cabeçalho de orientação ao operador na Tela de Coleta / Bipagem MES.
 * Oferece instruções claras do fluxo de bipagem, atalhos operacionais
 * e dicas de uso, mantendo o padrão visual do Design System do projeto.
 */
export default function CollectionHeaderGuide({ operator, cellName, machine }) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-r from-emerald-950/20 via-background to-teal-950/20 p-4 sm:p-5 shadow-md transition-all duration-300">
      {/* Glow de fundo */}
      <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-emerald-500/10 blur-3xl" />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Lado Esquerdo: Título e Status Operacional */}
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 shadow-sm">
            <ScanLine className="h-6 w-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-extrabold tracking-tight text-foreground sm:text-lg">
                Orientação ao Operador — Bipagem MES
              </h2>
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-medium text-[11px] gap-1">
                <Zap className="w-3 h-3 text-emerald-500" />
                Tempo Real
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Guia rápido para registro de produção, leitura de códigos/RFID e gestão de lote.
            </p>
          </div>
        </div>

        {/* Lado Direito: Botão para Expandir/Recolher Guia */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-8 px-3 rounded-lg text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 gap-1.5 border border-emerald-500/20"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>{isExpanded ? 'Ocultar Instruções' : 'Instruções do Posto'}</span>
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {/* Conteúdo Expandido das Instruções */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-emerald-500/15 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 animate-in fade-in slide-in-from-top-2 duration-300">
          
          {/* Passo 1 */}
          <div className="rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-sm space-y-1.5 transition-all hover:border-emerald-500/40">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-[11px]">1</span>
              <span>Identificação & Posto</span>
            </div>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              Confira se o seu operador <strong>({operator || 'Operador Logado'})</strong>, Célula <strong>({cellName || 'Nível Geral'})</strong> e Máquina <strong>({machine || 'Leitor Padrão'})</strong> estão corretos.
            </p>
          </div>

          {/* Passo 2 */}
          <div className="rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-sm space-y-1.5 transition-all hover:border-emerald-500/40">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-[11px]">2</span>
              <span>Leitura de Peça / Tag</span>
            </div>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              Mire o leitor no código de barras / QR Code ou aproxime a peça do leitor RFID para validar o avanço automático da etapa.
            </p>
          </div>

          {/* Passo 3 */}
          <div className="rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-sm space-y-1.5 transition-all hover:border-emerald-500/40">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-[11px]">3</span>
              <span>Andamento do Lote</span>
            </div>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              Ao confirmar a bipagem, a tela exibirá o <strong>Lote Geral</strong> e a porcentagem atualizada do lote do cliente em tempo real.
            </p>
          </div>

          {/* Passo 4 */}
          <div className="rounded-xl border border-border/70 bg-card/60 p-3.5 shadow-sm space-y-1.5 transition-all hover:border-amber-500/40">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold text-xs">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-[11px]">4</span>
              <span>Refugos & Paradas</span>
            </div>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              Utilize o botão <strong className="text-destructive">Refugar Peça</strong> para avarias ou <strong className="text-amber-600 dark:text-amber-400">Registrar Parada</strong> se a máquina pausar.
            </p>
          </div>

        </div>
      )}
    </div>
  );
}
