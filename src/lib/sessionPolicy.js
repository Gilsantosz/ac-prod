import { getSystemRoleLabel, normalizeSystemRole } from '@/lib/roleProfiles';

export const DEFAULT_SESSION_TIMEOUT_MINUTES = 30;
const DEFAULT_WARNING_SECONDS = 60;

function boundedInteger(value, minimum, maximum) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function timeoutMinutes(value) {
  return boundedInteger(value, 1, 1440);
}

function identifier(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function ownValue(map, key) {
  if (!key || !map || typeof map !== 'object' || Array.isArray(map)) return undefined;
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

function resolveCell(settings, user, operatorSession) {
  const rawCell = identifier(operatorSession
    ? operatorSession.selected_cell_id || operatorSession.primary_cell
    : user?.cell);
  if (!rawCell) return { id: null, name: null };

  const normalized = rawCell.toLowerCase();
  const catalog = Array.isArray(settings.cell_catalog) ? settings.cell_catalog : [];
  const exactCell = catalog.find((cell) => identifier(cell?.id).toLowerCase() === normalized);
  if (exactCell) return { id: identifier(exactCell.id), name: identifier(exactCell.name) || rawCell };

  const namedCells = catalog.filter((cell) => identifier(cell?.name).toLowerCase() === normalized);
  if (namedCells.length === 1 && identifier(namedCells[0].id)) {
    return { id: identifier(namedCells[0].id), name: identifier(namedCells[0].name) };
  }

  // Nomes ambíguos não escolhem uma célula arbitrariamente. UUIDs continuam
  // válidos enquanto o catálogo ainda não estiver disponível.
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuid.test(rawCell) ? { id: normalized, name: rawCell } : { id: null, name: null };
}

/**
 * Resolve a política sem efeitos colaterais: célula > nível de acesso > setor
 * cadastrado para a célula > padrão geral. Valores inválidos herdam o próximo
 * nível; nenhuma política pode desativar o encerramento por inatividade.
 */
export function resolveSessionPolicy(settings, user = null, operatorSession = null) {
  const config = settings && typeof settings === 'object' ? settings : {};
  const cell = resolveCell(config, user, operatorSession);
  const role = operatorSession ? 'operator' : user?.role ? normalizeSystemRole(user.role) : null;
  let minutes = timeoutMinutes(config.default_timeout_minutes) ?? DEFAULT_SESSION_TIMEOUT_MINUTES;
  let scope = 'global';
  let scopeLabel = 'Padrão do sistema';

  if (cell.id && Array.isArray(config.sectors)) {
    const sectors = config.sectors.filter((sector) => Array.isArray(sector?.cell_ids)
      && sector.cell_ids.some((id) => identifier(id).toLowerCase() === cell.id.toLowerCase())
      && timeoutMinutes(sector.timeout_minutes) !== null);
    // Se uma configuração antiga associar a célula a mais de um setor, aplica
    // o menor prazo válido até que a associação seja corrigida.
    const sector = sectors.reduce((selected, candidate) => !selected
      || Number(candidate.timeout_minutes) < Number(selected.timeout_minutes) ? candidate : selected, null);
    if (sector) {
      minutes = timeoutMinutes(sector.timeout_minutes);
      scope = 'sector';
      scopeLabel = `Setor: ${identifier(sector.name) || identifier(sector.id) || 'Cadastrado'}`;
    }
  }

  const roleMinutes = timeoutMinutes(ownValue(config.role_timeouts, role));
  if (roleMinutes !== null) {
    minutes = roleMinutes;
    scope = 'role';
    scopeLabel = `Nível de acesso: ${getSystemRoleLabel(role, { short: true })}`;
  }

  const cellMinutes = timeoutMinutes(ownValue(config.cell_timeouts, cell.id));
  if (cellMinutes !== null) {
    minutes = cellMinutes;
    scope = 'cell';
    scopeLabel = `Célula: ${cell.name || cell.id}`;
  }

  const warningSeconds = boundedInteger(config.warning_seconds, 0, 300) ?? DEFAULT_WARNING_SECONDS;
  return {
    timeoutMinutes: minutes,
    timeoutMs: minutes * 60 * 1000,
    warningSeconds: Math.min(warningSeconds, minutes * 60 - 1),
    scope,
    scopeLabel,
    cellId: cell.id,
  };
}
