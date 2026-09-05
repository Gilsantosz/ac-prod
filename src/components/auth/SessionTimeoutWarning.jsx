import { Timer } from 'lucide-react';

export default function SessionTimeoutWarning({ seconds, timeoutMinutes, onContinue }) {
  if (seconds === null || seconds <= 0) return null;
  return (
    <section
      role="status"
      aria-label="Aviso de encerramento da sessão"
      className="fixed bottom-5 left-4 right-4 z-[100] mx-auto max-w-lg rounded-2xl border border-amber-400/50 bg-slate-950 p-4 text-white shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <Timer className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Sua sessão será encerrada em {seconds}s</p>
          <p className="mt-1 text-sm text-slate-300">
            O limite desta tela é de {timeoutMinutes} minuto(s) sem atividade.
            As coletas já registradas neste aparelho serão preservadas.
          </p>
          <button type="button" onClick={onContinue}
            className="mt-3 rounded-lg bg-amber-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            Continuar conectado
          </button>
        </div>
      </div>
    </section>
  );
}
