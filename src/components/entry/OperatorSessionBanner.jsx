import { User2, Building2, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useOperatorSession } from '@/hooks/useOperatorSession';

/**
 * OperatorSessionBanner
 *
 * Banner exibido na parte superior da Entrada de Produção enquanto
 * o operador está logado. Mostra nome, matrícula, célula e turno.
 * Botão "Trocar" limpa sessão e volta ao login.
 */
export default function OperatorSessionBanner() {
  const { session, logout } = useOperatorSession();

  if (!session) return null;

  const expiresIn = Math.max(0, Math.floor((session.expires_at - Date.now()) / 60_000));
  const hoursLeft = Math.floor(expiresIn / 60);
  const minsLeft = expiresIn % 60;
  const expiryLabel = hoursLeft > 0 ? `${hoursLeft}h${minsLeft}min` : `${minsLeft}min`;

  return (
    <div className="flex flex-wrap items-center gap-3 bg-[#2d9c4a]/8 border border-[#2d9c4a]/20 rounded-xl px-4 py-3">
      {/* Ícone */}
      <div className="w-8 h-8 rounded-full bg-[#2d9c4a]/15 flex items-center justify-center shrink-0">
        <User2 className="w-4 h-4 text-[#2d9c4a]" />
      </div>

      {/* Info do operador */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-sm text-foreground truncate">{session.name}</span>
          {session.registration && (
            <Badge variant="outline" className="font-mono text-xs shrink-0">
              #{session.registration}
            </Badge>
          )}
          {session.shift && (
            <Badge variant="secondary" className="text-xs shrink-0">{session.shift}</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-0.5 text-xs text-muted-foreground">
          {session.primary_cell && (
            <span className="flex items-center gap-1">
              <Building2 className="w-3 h-3" />
              {session.primary_cell}
            </span>
          )}
          <span className="text-[#2d9c4a]/80">Sessão expira em {expiryLabel}</span>
        </div>
      </div>

      {/* Botão trocar */}
      <Button
        variant="outline"
        size="sm"
        onClick={logout}
        className="gap-1.5 text-xs shrink-0 hover:text-destructive hover:border-destructive/40"
      >
        <LogOut className="w-3.5 h-3.5" />
        Trocar operador
      </Button>
    </div>
  );
}
