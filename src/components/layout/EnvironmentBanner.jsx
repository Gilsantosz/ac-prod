import { FlaskConical } from 'lucide-react';
import { runtimeEnvironment } from '@/lib/runtimeEnvironment';

export default function EnvironmentBanner() {
  if (!runtimeEnvironment.isTest) return null;

  return (
    <aside
      className="fixed left-1/2 top-2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-300/80 bg-amber-400 px-3 py-1.5 text-xs font-extrabold text-slate-950 shadow-xl"
      data-testid="test-environment-banner"
      aria-label="Ambiente de teste isolado"
    >
      <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
      <span>TESTE ISOLADO · capacity-test</span>
      <a
        className="rounded-full bg-slate-950 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-slate-800"
        href={`${import.meta.env.BASE_URL}?ambiente=producao`}
      >
        Voltar à produção
      </a>
    </aside>
  );
}
