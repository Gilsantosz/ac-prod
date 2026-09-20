// Pure preflight shared by k6 and local unit tests. Never log fixture contents.
export const ISOLATED_COLLECTION_TEST_URL = 'https://smnsihksrhzbkhcbdjfu.supabase.co';
export const PRODUCTION_COLLECTION_URL = 'https://uozuzdfvnufsjsonswag.supabase.co';

// A positive gate is valid only while its catalog snapshot is recent.
export function isFreshCollectionImmediateSnapshot(payload, nowMs = Date.now()) {
  const refreshed = Date.parse(payload?.snapshot_refreshed_at);
  const expires = Date.parse(payload?.snapshot_expires_at);
  return payload?.snapshot_format === 'collection_immediate_release_snapshot_v1'
    && payload?.snapshot_status === 'fresh'
    && Number.isFinite(refreshed) && Number.isFinite(expires)
    && refreshed <= nowMs + 5000 && refreshed > nowMs - 180000
    && expires > nowMs && expires <= refreshed + 180000;
}

export const COLLECTION_LOAD_PROFILE_REQUIREMENTS = Object.freeze({
  smoke: { devices: 1, codes: 1, cells: 1, machines: 1, devicesPerCell: 1, machinesPerCell: 1 },
  nominal: { devices: 100, codes: 18000, cells: 2, machines: 4, devicesPerCell: 10, machinesPerCell: 2 },
  burst: { devices: 100, codes: 6000, cells: 2, machines: 4, devicesPerCell: 10, machinesPerCell: 2 },
  microbatch: { devices: 5, codes: 125, cells: 1, machines: 1, devicesPerCell: 1, machinesPerCell: 1 },
  priority: { devices: 100, codes: 1625, cells: 2, machines: 4, devicesPerCell: 10, machinesPerCell: 2 },
  idempotency: { devices: 20, codes: 20, cells: 1, machines: 1, devicesPerCell: 1, machinesPerCell: 1 },
  contention_piece: { devices: 20, codes: 1, cells: 1, machines: 20, devicesPerCell: 20, machinesPerCell: 20 },
  contention_cell_lot: { devices: 50, codes: 50, cells: 1, machines: 50, devicesPerCell: 50, machinesPerCell: 50 },
  // 26.265 chegadas planejadas, com pequena reserva contra arredondamento do executor.
  global_ramp: { devices: 1000, codes: 26300, cells: 2, machines: 4, devicesPerCell: 50, machinesPerCell: 2, tokenValidityMinutes: 45 },
});

export const COLLECTION_LOAD_CODE_SEGMENTS = Object.freeze({
  smoke: [{ scenario: 'smoke', offset: 0, iterations: 1, batchSize: 1 }],
  nominal: [{ scenario: 'nominal', offset: 0, iterations: 18000, batchSize: 1 }],
  burst: [{ scenario: 'burst', offset: 0, iterations: 6000, batchSize: 1 }],
  microbatch: [{ scenario: 'microbatch', offset: 0, iterations: 5, batchSize: 25 }],
  priority: [
    { scenario: 'priority_replay_seed', offset: 0, iterations: 5, batchSize: 25 },
    { scenario: 'priority_live', offset: 125, iterations: 1200, batchSize: 1 },
    { scenario: 'priority_replay', offset: 1325, iterations: 300, batchSize: 1 },
  ],
  idempotency: [{ scenario: 'idempotency', offset: 0, iterations: 20, batchSize: 1 }],
  contention_piece: [{ scenario: 'contention_piece', offset: 0, iterations: 20, batchSize: 1, sameCode: true }],
  contention_cell_lot: [{ scenario: 'contention_cell_lot', offset: 0, iterations: 50, batchSize: 1 }],
  global_ramp: [{ scenario: 'global_ramp', offset: 0, iterations: 26300, batchSize: 1 }],
});

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertIsolatedCollectionTarget(url, target, confirmation) {
  if (url !== ISOLATED_COLLECTION_TEST_URL || target !== 'staging'
      || confirmation !== 'staging-v3-load') {
    throw new Error('Carga bloqueada: somente capacity-test, K6_TARGET=staging e K6_CONFIRM_WRITES=staging-v3-load sao permitidos.');
  }
}

export function assertProductionCollectionReadOnlyTarget(url, target, confirmation) {
  if (url !== PRODUCTION_COLLECTION_URL || target !== 'production-readonly'
      || confirmation !== 'production-gate-readonly-40rps') {
    throw new Error('Leitura bloqueada: o perfil exige o projeto principal exato, K6_TARGET=production-readonly e confirmação somente leitura.');
  }
}

export function validateCollectionIdentities(fixture, requirement, decodeClaims, nowMs = Date.now()) {
  const devices = fixture.devices || [];
  if (devices.length < requirement.devices) throw new Error('Fixture insuficiente: faltam dispositivos autorizados.');
  const active = devices.slice(0, requirement.devices);
  const users = new Set();
  const sessions = new Set();
  const deviceIds = new Set();
  const cells = new Set();
  const machines = new Set();
  const cellDevices = new Map();
  const cellMachines = new Map();
  const tokenValidityMinutes = Math.max(15, requirement.tokenValidityMinutes || 15);
  for (const [index, device] of active.entries()) {
    const invalidId = ['device_id', 'operator_session_id', 'cell_id', 'machine_id']
      .some((key) => !uuid.test(device[key] || ''));
    if (invalidId) throw new Error(`Fixture invalida: IDs de dispositivo/sessao/celula/maquina no indice ${index}.`);
    let claims;
    try { claims = decodeClaims(device.access_token || fixture.access_token || ''); } catch { /* fail closed below */ }
    if (!claims || !uuid.test(claims.sub || '') || claims.role !== 'authenticated'
        || claims.iss !== `${ISOLATED_COLLECTION_TEST_URL}/auth/v1`
        || !Number.isFinite(claims.exp)
        || claims.exp * 1000 <= nowMs + tokenValidityMinutes * 60 * 1000) {
      throw new Error(`Fixture invalida: JWT de usuario do teste deve durar ao menos ${tokenValidityMinutes} minutos (indice ${index}).`);
    }
    if (users.has(claims.sub) || sessions.has(device.operator_session_id) || deviceIds.has(device.device_id)) {
      throw new Error('Fixture invalida: carga multiusuario exige usuarios, sessoes e dispositivos distintos.');
    }
    users.add(claims.sub);
    sessions.add(device.operator_session_id);
    deviceIds.add(device.device_id);
    cells.add(device.cell_id);
    machines.add(device.machine_id);
    cellDevices.set(device.cell_id, (cellDevices.get(device.cell_id) || 0) + 1);
    if (!cellMachines.has(device.cell_id)) cellMachines.set(device.cell_id, new Set());
    cellMachines.get(device.cell_id).add(device.machine_id);
  }
  if (cells.size < (requirement.cells || 1)) {
    throw new Error(`Fixture invalida: este perfil exige ao menos ${requirement.cells} celulas distintas.`);
  }
  if (machines.size < (requirement.machines || 1)) {
    throw new Error(`Fixture invalida: este perfil exige ao menos ${requirement.machines} postos distintos.`);
  }
  for (const cellId of cells) {
    if ((cellDevices.get(cellId) || 0) < (requirement.devicesPerCell || 1)) {
      throw new Error(`Fixture invalida: cada celula deve ter ao menos ${requirement.devicesPerCell} dispositivos.`);
    }
    if ((cellMachines.get(cellId)?.size || 0) < (requirement.machinesPerCell || 1)) {
      throw new Error(`Fixture invalida: cada celula deve ter ao menos ${requirement.machinesPerCell} postos distintos.`);
    }
  }
  return {
    users: users.size,
    sessions: sessions.size,
    devices: deviceIds.size,
    cells: cells.size,
    machines: machines.size,
  };
}

export function validateCollectionCodeWindow(fixture, profile, codeOffset) {
  const requirement = COLLECTION_LOAD_PROFILE_REQUIREMENTS[profile];
  const segments = COLLECTION_LOAD_CODE_SEGMENTS[profile];
  if (!requirement || !segments) throw new Error(`Perfil de carga desconhecido: ${profile}.`);
  if (!Number.isSafeInteger(codeOffset) || codeOffset < 0) {
    throw new Error('K6_CODE_OFFSET deve ser um inteiro nao negativo reservado para a rodada.');
  }

  const devices = (fixture.devices || []).slice(0, requirement.devices);
  const codes = (fixture.codes || []).map(String);
  const window = codes.slice(codeOffset, codeOffset + requirement.codes);
  if (window.length !== requirement.codes) {
    throw new Error(`Fixture insuficiente: ${profile} exige ${requirement.codes} codigos a partir de K6_CODE_OFFSET.`);
  }
  if (window.some((code) => !/^\d{8}$/.test(code))) {
    throw new Error('Fixture invalida: todos os codigos reservados devem conter exatamente oito digitos.');
  }
  if (new Set(window).size !== window.length) {
    throw new Error('Fixture invalida: a janela de codigos da rodada contem duplicatas.');
  }
  if (requirement.cells > 1 && !fixture.code_cells) {
    throw new Error('Fixture multicelula exige code_cells para a janela reservada.');
  }

  for (const segment of segments) {
    for (let iteration = 0; iteration < segment.iterations; iteration += 1) {
      const device = devices[iteration % devices.length];
      for (let eventIndex = 0; eventIndex < segment.batchSize; eventIndex += 1) {
        const relativeIndex = segment.sameCode
          ? segment.offset
          : segment.offset + (iteration * segment.batchSize) + eventIndex;
        const code = codes[codeOffset + relativeIndex];
        const targetCell = fixture.code_cells?.[code];
        if (targetCell && targetCell !== device.cell_id) {
          throw new Error(`Fixture invalida: roteamento de codigo nao corresponde ao dispositivo no segmento ${segment.scenario}.`);
        }
        if (requirement.cells > 1 && !targetCell) {
          throw new Error(`Fixture invalida: codigo sem destino de celula no segmento ${segment.scenario}.`);
        }
      }
    }
  }
  return { codeOffset, codes: requirement.codes, segments: segments.length };
}

export function assertVerifiedCollectionSession(
  device,
  user,
  session,
  nowMs = Date.now(),
  validityMinutes = 15,
) {
  if (!user?.id || session?.auth_user_id !== user.id
      || session.id !== device.operator_session_id
      || session.cell_id !== device.cell_id || session.machine_id !== device.machine_id
      || session.device_id !== device.device_id
      || session.ended_at || session.revoked_at
      || !Number.isFinite(Date.parse(session.expires_at))
      || Date.parse(session.expires_at) <= nowMs + validityMinutes * 60 * 1000) {
    throw new Error('Preflight remoto recusado: sessao, usuario ou contexto operacional nao corresponde a fixture.');
  }
}
