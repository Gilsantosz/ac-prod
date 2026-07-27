import { useEffect } from 'react';
import { PlusCircle, LogOut } from 'lucide-react';
import { useOperatorSession } from '@/hooks/useOperatorSession';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/PageHeader';
import TraceabilityCollection from '@/pages/TraceabilityCollection';
import OperationalLoginGate from '@/components/entry/OperationalLoginGate';

export default function CollectionPage() {
  const { isLoggedIn, logout } = useOperatorSession();

  // Ao sair da página (desmontar o componente), o login deve ser pedido novamente
  useEffect(() => {
    return () => {
      logout();
    };
  }, [logout]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-5 sm:space-y-6">
      <PageHeader
        title="Coleta / Bipagem"
        subtitle="Estação de controle operacional de coleta — bipagem por código de barras, QR Code ou RFID."
        icon={PlusCircle}
        actions={
          <div className="flex items-center gap-3">
            {isLoggedIn && (
              <Button
                variant="outline"
                size="sm"
                onClick={logout}
                className="rounded-xl border-emerald-500/30 hover:bg-emerald-500/10 text-foreground gap-2 h-9"
              >
                <LogOut className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Trocar Operador</span>
              </Button>
            )}
          </div>
        }
      />
      <OperationalLoginGate>
        <TraceabilityCollection embedded={true} />
      </OperationalLoginGate>
    </div>
  );
}
