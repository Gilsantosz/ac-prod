import { useCallback, useEffect, useState } from 'react';
import { getConfirmedOperatorContext } from '@/lib/operatorSessionService';

const STATION_NAME = 'Coletor Chão de Fábrica';

/** Confirma o posto para cada sessão, inclusive ao reutilizar a máquina salva. */
export function useCollectionOperatorContext({ session, cellId, machineId, setContext }) {
  const [attempt, setAttempt] = useState(0);
  const [confirmation, setConfirmation] = useState(null);
  const token = session?.token;
  const sessionId = session?.session_id;
  const confirmedContext = getConfirmedOperatorContext(session);
  const contextMismatch = Boolean(confirmedContext
    && (confirmedContext.cellId !== cellId || confirmedContext.machineId !== machineId));
  const key = JSON.stringify([token, sessionId, cellId, machineId, attempt]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!token || !sessionId || !cellId || !machineId || contextMismatch) return undefined;
    let cancelled = false;
    setConfirmation({ key, confirmed: false, error: null });
    Promise.resolve().then(() => cancelled ? null : setContext(cellId, machineId, STATION_NAME)).then(
      (confirmedSession) => {
        if (cancelled) return;
        const confirmed = confirmedSession?.token === token
          && confirmedSession?.session_id === sessionId
          && confirmedSession?.selected_cell_id === cellId
          && confirmedSession?.selected_machine_id === machineId;
        setConfirmation({
          key,
          confirmed,
          error: confirmed ? null : 'O posto mudou durante a confirmação. Tente novamente.',
        });
      },
      (error) => {
        if (!cancelled) setConfirmation({
          key, confirmed: false,
          error: error?.message || 'Não foi possível confirmar o posto operacional.',
        });
      },
    );
    return () => { cancelled = true; };
  }, [key, token, sessionId, cellId, machineId, contextMismatch, setContext]);

  useEffect(() => {
    // Uma conexão restaurada deve permitir sair de uma falha de confirmação.
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [retry]);

  const error = confirmation?.key === key ? confirmation.error : null;
  const contextReady = Boolean(
    token && sessionId && cellId && machineId
    && confirmation?.key === key && confirmation.confirmed
    && session.context_session_id === sessionId && !session.context_pending
    && session.selected_cell_id === cellId
    && session.selected_machine_id === machineId
    && session.selected_station_name === STATION_NAME,
  );
  const contextMessage = contextMismatch
    ? 'Posto fixo nesta sessão. Para mudar, use Trocar Operador.'
    : error
    ? `Coleta bloqueada: ${error}`
    : !cellId
      ? 'Selecione uma célula autorizada para o operador.'
      : !machineId
        ? 'Selecione a máquina / posto antes de iniciar a coleta.'
        : 'Validando a célula e o posto do operador no servidor...';

  return { contextReady, contextMessage, error, retry };
}
