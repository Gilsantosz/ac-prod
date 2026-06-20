import { Barcode, Keyboard, RadioTower, ScanLine } from 'lucide-react';
import { cn } from '@/lib/utils';

const MODES = [
  { value: 'scanner', label: 'Scanner físico', icon: Barcode },
  { value: 'camera', label: 'Câmera do celular', icon: ScanLine },
  { value: 'manual', label: 'Manual', icon: Keyboard },
  { value: 'rfid', label: 'RFID futuro', icon: RadioTower },
];

export default function ScannerModeSelector({ value, onChange }) {
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-2" role="radiogroup" aria-label="Modo de leitura">
      {MODES.map(({ value: mode, label, icon: Icon }) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          onClick={() => onChange(mode)}
          className={cn(
            'h-14 px-3 rounded-md border flex items-center justify-center gap-2 text-sm font-semibold transition-colors',
            value === mode
              ? 'bg-[#00522d] border-[#00522d] text-white'
              : 'bg-card border-border text-muted-foreground hover:text-foreground hover:bg-secondary',
          )}
        >
          <Icon className="w-5 h-5 shrink-0" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
