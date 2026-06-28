/**
 * AC.Prod — Sessão Operacional
 *
 * Login operacional (nome + matrícula) separado do Supabase Auth.
 * Armazena sessão em sessionStorage (expira ao fechar a aba).
 */

import { supabase } from '@/lib/supabaseClient';

const SESSION_KEY = 'acprod_operator_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas

// ─── Estrutura de sessão ──────────────────────────────────────────────────────

/**
 * @typedef {Object} OperatorSession
 * @property {string} id
 * @property {string} name
 * @property {string} registration
 * @property {string|null} primary_cell
 * @property {string[]} cells
 * @property {string|null} shift
 * @property {boolean} login_enabled
 * @property {number} expires_at — timestamp Unix em ms
 */

// ─── Login ────────────────────────────────────────────────────────────────────

/**
 * Autentica operador via RPC `operator_login`.
 * @param {string} name — nome ou login do operador
 * @param {string} registration — matrícula (senha operacional)
 * @returns {Promise<OperatorSession>}
 * @throws {Error} se credenciais inválidas ou operador inativo
 */
export async function loginOperator(name, registration) {
  if (!name?.trim()) throw new Error('Informe o nome do operador.');
  if (!registration?.trim()) throw new Error('Informe a matrícula.');

  const { data, error } = await supabase.rpc('operator_login', {
    p_name: name.trim(),
    p_registration: registration.trim(),
  });

  if (error) {
    throw new Error(`Falha ao conectar: ${error.message}`);
  }

  if (!data?.success) {
    throw new Error(data?.error || 'Operador não encontrado ou credenciais inválidas.');
  }

  const session = {
    id: data.id,
    name: data.name,
    registration: data.registration,
    primary_cell: data.primary_cell || null,
    cells: data.cells || [],
    shift: data.shift || null,
    login_enabled: data.login_enabled !== false,
    expires_at: Date.now() + SESSION_TTL_MS,
    logged_at: new Date().toISOString(),
  };

  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (_) {
    // sessionStorage pode estar bloqueado em alguns contextos
    console.warn('[operatorSession] sessionStorage indisponível — sessão em memória apenas.');
    _memorySession = session;
  }

  return session;
}

// Fallback em memória quando sessionStorage está bloqueado
let _memorySession = null;

/**
 * Retorna a sessão operacional ativa, ou null se não há sessão válida.
 * @returns {OperatorSession|null}
 */
export function getOperatorSession() {
  // Memória primeiro
  if (_memorySession && _memorySession.expires_at > Date.now()) return _memorySession;
  if (_memorySession) { _memorySession = null; return null; }

  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session?.expires_at || session.expires_at < Date.now()) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch (_) {
    return null;
  }
}

/**
 * Verifica se existe uma sessão operacional ativa.
 */
export function isOperatorLoggedIn() {
  return getOperatorSession() !== null;
}

/**
 * Limpa a sessão operacional (logout).
 */
export function clearOperatorSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* ignore */ }
  _memorySession = null;
}

/**
 * Renova o TTL da sessão (útil para prolongar durante uso ativo).
 */
export function refreshOperatorSessionTTL() {
  const session = getOperatorSession();
  if (!session) return;
  const renewed = { ...session, expires_at: Date.now() + SESSION_TTL_MS };
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(renewed));
  } catch (_) {
    _memorySession = renewed;
  }
}
