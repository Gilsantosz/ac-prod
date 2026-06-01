import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, RefreshCw, CheckCircle2 } from 'lucide-react';

export default function SyncStatus({ online, pending, syncing }) {
  return (
    <div className="flex items-center gap-2">
      {online ? (
        <Badge variant="secondary" className="gap-1.5">
          <Wifi className="w-3.5 h-3.5 text-green-600" /> Online
        </Badge>
      ) : (
        <Badge variant="destructive" className="gap-1.5">
          <WifiOff className="w-3.5 h-3.5" /> Offline
        </Badge>
      )}

      {pending > 0 ? (
        <Badge variant="outline" className="gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          {pending} pendente{pending > 1 ? 's' : ''}
        </Badge>
      ) : (
        online && (
          <Badge variant="outline" className="gap-1.5 text-muted-foreground">
            <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> Sincronizado
          </Badge>
        )
      )}
    </div>
  );
}