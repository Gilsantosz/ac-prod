import { useOperatorSession } from '@/hooks/useOperatorSession';
import { useAuth } from '@/lib/AuthContext';
import { useCells } from '@/hooks/useCells';
import { hasMarcenariaAccess, getOperatorAllowedCells } from '@/lib/operatorCellRules';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/ui/PageHeader';
import JoineryWorkbench from '@/components/traceability/JoineryWorkbench';
import OperationalLoginGate from '@/components/entry/OperationalLoginGate';
import { Wrench, LogOut, ShieldAlert, ArrowLeft } from 'lucide-react';

export default function JoineryPage() {
  const { isLoggedIn, session, logout } = useOperatorSession();
  const { user } = useAuth();
  const { cells } = useCells();

  // Validação estrita de permissão para a célula Marcenaria
  const isAllowed = hasMarcenariaAccess({ user, opSession: session, allCells: cells });
  const allowedCells = getOperatorAllowedCells({ user, opSession: session, allCells: cells });

  if (!isLoggedIn) {
    return (
      <div className="p-2 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
        <OperationalLoginGate
          pageTitle="Marcenaria"
          pageSubtitle="ACOMPANHAMENTO DA MARCENARIA"
          pageDescription="Identifique-se para visualizar as peças e o andamento da Marcenaria. As coletas são registradas em Coleta / Bipagem."
          icon={Wrench}
        />
      </div>
    );
  }

  // Se o operador autenticado não tem a célula Marcenaria no cadastro
  if (!isAllowed) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300">
        <PageHeader
          title="Marcenaria"
          subtitle="Consulta de peças, status e andamento produtivo."
          icon={Wrench}
        />

        <div className="rounded-3xl border border-destructive/30 bg-destructive/5 dark:bg-destructive/10 p-6 sm:p-8 space-y-5 shadow-lg">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-destructive/15 text-destructive border border-destructive/30">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-extrabold text-foreground">Acesso Não Autorizado à Marcenaria</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                O operador <strong className="text-foreground">{session?.name || user?.name}</strong> não possui a célula <strong className="text-foreground font-semibold">"Marcenaria"</strong> em seu cadastro de permissões operacionais.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-border/80 bg-card/60 p-4 space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Células autorizadas para este operador:</p>
            {allowedCells.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {allowedCells.map(c => (
                  <span key={c.id || c.name} className="px-3 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold text-xs">
                    {c.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs font-semibold text-destructive">Nenhuma célula autorizada. Solicite a inclusão de células ao seu supervisor.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button
              onClick={() => window.location.href = '#/coleta'}
              className="rounded-xl font-bold bg-emerald-700 hover:bg-emerald-800 text-white gap-2 h-10 px-4 text-xs"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Ir para Coleta / Bipagem</span>
            </Button>

            <Button
              variant="outline"
              onClick={logout}
              className="rounded-xl border-border text-foreground gap-2 h-10 px-4 text-xs hover:bg-secondary"
            >
              <LogOut className="w-4 h-4 text-muted-foreground" />
              <span>Trocar Operador</span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-5 sm:space-y-6">
      <PageHeader
        title="Marcenaria"
        subtitle="Consulta de peças, status e andamento produtivo."
        icon={Wrench}
        actions={
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={logout}
              className="rounded-xl border-emerald-500/30 hover:bg-emerald-500/10 text-foreground gap-2 h-9"
            >
              <LogOut className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Trocar Operador</span>
            </Button>
          </div>
        }
      />
      <JoineryWorkbench />
    </div>
  );
}
