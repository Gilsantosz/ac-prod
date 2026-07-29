import { Barcode, Boxes, Keyboard, ScanLine, AlertTriangle, Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const MODES = [
  { value: 'scanner', label: 'Scanner físico', icon: Barcode },
  { value: 'camera', label: 'Câmera do celular', icon: ScanLine },
  { value: 'manual', label: 'Código individual', icon: Keyboard },
  { value: 'volume', label: 'Baixa por volume', icon: Boxes },
];

export default function ScannerModeSelector({ value, onChange, onOpenDowntime, onToggleKiosk }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-2" role="radiogroup" aria-label="Modo de leitura">
      {MODES.map(({ value: mode, label, icon: Icon }) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          onClick={() => onChange(mode)}
          className={cn(
            'h-14 px-3 rounded-md border flex items-center justify-center gap-2 text-sm font-semibold transition-colors cursor-pointer',
            value === mode
              ? 'bg-[#00522d] border-[#00522d] text-white'
              : 'bg-card border-border text-muted-foreground hover:text-foreground hover:bg-secondary',
          )}
        >
          <Icon className="w-5 h-5 shrink-0" />
          <span>{label}</span>
        </button>
      ))}

      {onToggleKiosk && (
        <button
          type="button"
          onClick={() => onToggleKiosk?.()}
          className="h-14 px-3 rounded-md border border-emerald-600/80 bg-emerald-700 hover:bg-emerald-800 text-white flex items-center justify-center gap-2 text-sm font-extrabold shadow-sm transition-colors cursor-pointer"
        >
          <Maximize2 className="w-5 h-5 shrink-0" />
          <span>Modo Foco</span>
        </button>
      )}

      {/* Botão de Registrar Parada substituindo o antigo RFID */}
      <button
        type="button"
        onClick={() => onOpenDowntime?.()}
        className="h-14 px-3 rounded-md border border-amber-600/80 bg-amber-600 hover:bg-amber-700 text-white flex items-center justify-center gap-2 text-sm font-extrabold shadow-sm transition-colors cursor-pointer"
      >
        <AlertTriangle className="w-5 h-5 shrink-0" />
        <span>Registrar Parada</span>
      </button>
    </div>
  );
}
