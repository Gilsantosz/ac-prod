/**
 * Formata um valor numérico em minutos para visualização humanizada em horas e minutos.
 *
 * Exemplos:
 *   0 minutos   → 0min
 *   45 minutos  → 45min
 *   60 minutos  → 1h
 *   135 minutos → 2h 15min
 *   674 minutos → 11h 14min
 */
export function formatDuration(minutes) {
  const totalMin = Math.max(0, Math.round(Number(minutes) || 0));
  if (totalMin === 0) return '0min';

  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;

  if (hours === 0) {
    return `${mins}min`;
  }
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}min`;
}

/**
 * Converte horas e minutos para o total de minutos para gravação no banco.
 */
export function toTotalMinutes(hours, minutes) {
  const h = Math.max(0, Math.floor(Number(hours) || 0));
  const m = Math.max(0, Math.min(59, Math.floor(Number(minutes) || 0)));
  return h * 60 + m;
}

/**
 * Decompõe o total de minutos em { hours, minutes } para preencher campos de formulário.
 */
export function toHoursAndMinutes(totalMinutes) {
  const totalMin = Math.max(0, Math.floor(Number(totalMinutes) || 0));
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return { hours, minutes };
}
