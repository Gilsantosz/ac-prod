/**
 * AC.Prod MES — Serviço de Sessão Operacional V2
 *
 * Gerencia o login operacional com sessão opaca no servidor e token temporário.
 * Respeita a LEI 01 (Isolamento de Segurança Smith) e as diretrizes do prompt.
 */

import { supabase } from '@/lib/supabaseClient';

const SESSION_KEY = 'acprod_operator_session';

// Fallback em memória quando sessionStorage está bloqueado
let _memorySession = null;

/**
 * Obtém ou gera um ID de dispositivo persistente para fins de auditoria e rate limit.
 */
export function getDeviceId() {
  try {
    let devId = localStorage.getItem('acprod_device_id');
    if (!devId) {
      devId = typeof crypto !== 'undefined' && crypto.randomUUID 
        ? crypto.randomUUID() 
        : 'dev-' + Math.random().toString(36).slice(2, 11);
      localStorage.setItem('acprod_device_id', devId);
    }
    return devId;
  } catch (_) {
    return 'browser-station';
  }
}

function notifySessionChange() {
  try {
    window.dispatchEvent(new CustomEvent('operator-session-changed'));
  } catch (_) { /* ignore */ }
}

/**
 * Autentica o operador via RPC seguro `operator_login_v2` e cria sessão no servidor.
 */
export async function loginOperator(loginName, registration) {
  if (!loginName?.trim()) throw new Error('Informe o nome de login do operador.');
  if (!registration?.trim()) throw new Error('Informe a matrícula.');

  const deviceId = getDeviceId();

  const { data, error } = await supabase.rpc('operator_login_v2', {
    p_login_name: loginName.trim(),
    p_registration: registration.trim(),
    p_device_id: deviceId
  });

  if (error) {
    throw new Error(`Falha ao conectar: ${error.message}`);
  }

  if (!data?.success) {
    throw new Error(data?.error || 'Operador não encontrado ou credenciais inválidas.');
  }

  const { session_id, session_token, expires_at, operator } = data;

  const session = {
    id: operator.id,
    name: operator.name,
    login_name: operator.login_name,
    registration: operator.registration_masked, // Matrícula já vem mascarada do servidor
    primary_cell: operator.primary_cell_id || null,
    primary_machine: operator.primary_machine_id || null,
    cells: operator.cells || [],
    machines: operator.machines || [],
    shift: operator.shift || null,
    token: session_token,
    session_id: session_id,
    expires_at: new Date(expires_at).getTime(),
    logged_at: new Date().toISOString()
  };

  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (_) {
    _memorySession = session;
  }

  notifySessionChange();
  return session;
}

/**
 * Define o contexto operacional de posto (célula e máquina) na sessão atual.
 */
export async function setOperatorSessionContext(cellId, machineId = null, stationName = 'Coletor Chão de Fábrica') {
  const session = getOperatorSession();
  if (!session?.token) throw new Error('Nenhuma sessão ativa encontrada.');

  const { data, error } = await supabase.rpc('set_operator_session_context', {
    p_session_token: session.token,
    p_cell_id: cellId,
    p_machine_id: machineId,
    p_station_name: stationName
  });

  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Falha ao definir posto operacional.');

  // Obter detalhes dos nomes para atualizar localmente
  const cellObj = session.cells.find(c => c.id === cellId);
  const machObj = session.machines.find(m => m.id === machineId);

  const updatedSession = {
    ...session,
    selected_cell_id: cellId,
    selected_cell_name: cellObj?.name || 'Célula',
    selected_machine_id: machineId,
    selected_machine_name: machObj?.name || null,
    selected_station_name: stationName
  };

  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(updatedSession));
  } catch (_) {
    _memorySession = updatedSession;
  }

  notifySessionChange();
  return updatedSession;
}

/**
 * Envia batimento de batida (heartbeat) para estender a validade da sessão no Supabase.
 */
export async function heartbeatOperatorSession() {
  const session = getOperatorSession();
  if (!session?.token) return;

  const { data, error } = await supabase.rpc('heartbeat_operator_session', {
    p_session_token: session.token
  });

  if (error) {
    console.error('[operatorSession] Falha no heartbeat:', error);
    return;
  }

  if (data?.success) {
    const renewed = {
      ...session,
      expires_at: Date.now() + 8 * 60 * 60 * 1000 // Renova mais 8h localmente
    };
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(renewed));
    } catch (_) {
      _memorySession = renewed;
    }
  } else {
    // Sessão expirada/revogada no banco
    clearOperatorSession();
  }
}

/**
 * Retorna a sessão operacional ativa se for válida.
 */
export function getOperatorSession() {
  if (_memorySession && _memorySession.expires_at > Date.now()) return _memorySession;
  if (_memorySession) { _memorySession = null; notifySessionChange(); return null; }

  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session?.expires_at || session.expires_at < Date.now()) {
      sessionStorage.removeItem(SESSION_KEY);
      notifySessionChange();
      return null;
    }
    return session;
  } catch (_) {
    return null;
  }
}

export function isOperatorLoggedIn() {
  return getOperatorSession() !== null;
}

/**
 * Limpa a sessão localmente e notifica o encerramento ao servidor.
 */
export async function clearOperatorSession() {
  const session = getOperatorSession();
  if (session?.token) {
    try {
      await supabase.rpc('logout_operator_session', {
        p_session_token: session.token
      });
    } catch (e) {
      console.warn('Erro ao notificar logout no servidor:', e);
    }
  }

  try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* ignore */ }
  _memorySession = null;
  notifySessionChange();
}

/**
 * Wrapper de compatibilidade legada.
 */
export function refreshOperatorSessionTTL() {
  heartbeatOperatorSession();
}
