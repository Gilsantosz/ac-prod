// Pure preflight shared by k6 and local unit tests. Never log fixture contents.
export const ISOLATED_COLLECTION_TEST_URL = 'https://smnsihksrhzbkhcbdjfu.supabase.co';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertIsolatedCollectionTarget(url, target, confirmation) {
  if (url !== ISOLATED_COLLECTION_TEST_URL || target !== 'staging'
      || confirmation !== 'staging-v3-load') {
    throw new Error('Carga bloqueada: somente capacity-test, K6_TARGET=staging e K6_CONFIRM_WRITES=staging-v3-load sao permitidos.');
  }
}

export function validateCollectionIdentities(fixture, requirement, decodeClaims, nowMs = Date.now()) {
  const devices = fixture.devices || [];
  if (devices.length < requirement.devices) throw new Error('Fixture insuficiente: faltam dispositivos autorizados.');
  const active = devices;
  const users = new Set();
  const sessions = new Set();
  const deviceIds = new Set();
  const cells = new Set();
  for (const [index, device] of active.entries()) {
    const invalidId = ['device_id', 'operator_session_id', 'cell_id', 'machine_id']
      .some((key) => !uuid.test(device[key] || ''));
    if (invalidId) throw new Error(`Fixture invalida: IDs de dispositivo/sessao/celula/maquina no indice ${index}.`);
    let claims;
    try { claims = decodeClaims(device.access_token || fixture.access_token || ''); } catch { /* fail closed below */ }
    if (!claims || !uuid.test(claims.sub || '') || claims.role !== 'authenticated'
        || claims.iss !== `${ISOLATED_COLLECTION_TEST_URL}/auth/v1`
        || !Number.isFinite(claims.exp) || claims.exp * 1000 <= nowMs + 15 * 60 * 1000) {
      throw new Error(`Fixture invalida: JWT de usuario do teste deve durar ao menos 15 minutos (indice ${index}).`);
    }
    if (users.has(claims.sub) || sessions.has(device.operator_session_id) || deviceIds.has(device.device_id)) {
      throw new Error('Fixture invalida: carga multiusuario exige usuarios, sessoes e dispositivos distintos.');
    }
    users.add(claims.sub);
    sessions.add(device.operator_session_id);
    deviceIds.add(device.device_id);
    cells.add(device.cell_id);
  }
  if (cells.size < (requirement.cells || 1)) {
    throw new Error(`Fixture invalida: este perfil exige ao menos ${requirement.cells} celulas distintas.`);
  }
  if ((requirement.cells || 1) > 1) {
    const codes = (fixture.codes || []).map(String);
    if (codes.some((code) => !cells.has(fixture.code_cells?.[code]))) {
      throw new Error('Fixture multicelula exige code_cells com o destino autorizado de cada codigo.');
    }
  }
  return { users: users.size, sessions: sessions.size, devices: deviceIds.size, cells: cells.size };
}

export function assertVerifiedCollectionSession(device, user, session, nowMs = Date.now()) {
  if (!user?.id || session?.auth_user_id !== user.id
      || session.id !== device.operator_session_id
      || session.cell_id !== device.cell_id || session.machine_id !== device.machine_id
      || session.ended_at || session.revoked_at
      || !Number.isFinite(Date.parse(session.expires_at))
      || Date.parse(session.expires_at) <= nowMs + 15 * 60 * 1000) {
    throw new Error('Preflight remoto recusado: sessao, usuario ou contexto operacional nao corresponde a fixture.');
  }
}
