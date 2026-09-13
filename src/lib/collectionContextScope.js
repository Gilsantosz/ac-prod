/**
 * Sem máquina selecionada, preserva o acompanhamento agregado da célula.
 * Um posto com máquina selecionada só pode receber o contexto dessa máquina;
 * a linha geral da célula (machine_id nulo) não é um curinga para esse posto.
 */
export function collectionContextMatchesMachine(activeMachineId, eventMachineId) {
  if (!activeMachineId) return true;
  if (!eventMachineId) return false;
  return String(activeMachineId) === String(eventMachineId);
}
