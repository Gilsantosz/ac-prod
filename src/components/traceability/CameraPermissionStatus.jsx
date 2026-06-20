import { AlertTriangle, Camera, CheckCircle2, Loader2 } from 'lucide-react';

const STATES = {
  requesting: { icon: Loader2, text: 'Solicitando acesso à câmera...', color: 'text-blue-600', spin: true },
  granted: { icon: CheckCircle2, text: 'Câmera pronta para leitura', color: 'text-emerald-600' },
  denied: { icon: AlertTriangle, text: 'Permissão da câmera negada. Use o modo manual.', color: 'text-red-600' },
  unsupported: { icon: AlertTriangle, text: 'Câmera não suportada neste navegador.', color: 'text-amber-600' },
  idle: { icon: Camera, text: 'Aguardando ativação da câmera', color: 'text-muted-foreground' },
};

export default function CameraPermissionStatus({ status = 'idle', message }) {
  const config = STATES[status] || STATES.idle;
  const Icon = config.icon;
  return (
    <div className={`flex items-center gap-2 text-sm ${config.color}`} role="status">
      <Icon className={`w-4 h-4 ${config.spin ? 'animate-spin' : ''}`} />
      <span>{message || config.text}</span>
    </div>
  );
}
