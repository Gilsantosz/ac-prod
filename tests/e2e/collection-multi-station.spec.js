import { expect, test } from 'playwright/test';

test.setTimeout(60_000);

const RECEIVED_AT_DB = new Date().toISOString();

const PERSONAS = {
  corte: {
    key: 'corte',
    userId: '10000000-0000-4000-8000-000000000001',
    operatorId: '10000000-0000-4000-8000-000000000101',
    login: 'operador.corte.e2e',
    registration: 'matricula-corte-e2e',
    name: 'Operador Corte E2E',
    cellId: '10000000-0000-4000-8000-000000000201',
    cellName: 'Corte',
    machineId: '10000000-0000-4000-8000-000000000301',
    machineName: 'Nanshing E2E',
    code: '09950101',
    activeContext: {
      active_pcp_import_batch_id: '10000000-0000-4000-8000-000000000401',
      active_general_lot_code: 'GER-CORTE-01',
      active_lot_id: '10000000-0000-4000-8000-000000000501',
      active_lot_code: 'CLI-CORTE-01',
      customer_name: 'Cliente Corte E2E',
      progress_percent: 25,
    },
  },
  bordo: {
    key: 'bordo',
    userId: '20000000-0000-4000-8000-000000000001',
    operatorId: '20000000-0000-4000-8000-000000000101',
    login: 'operador.bordo.e2e',
    registration: 'matricula-bordo-e2e',
    name: 'Operador Bordo E2E',
    cellId: '20000000-0000-4000-8000-000000000201',
    cellName: 'Bordo',
    machineId: '20000000-0000-4000-8000-000000000301',
    machineName: 'Coladeira E2E',
    code: '09950201',
    activeContext: {
      active_pcp_import_batch_id: '20000000-0000-4000-8000-000000000401',
      active_general_lot_code: 'GER-BORDO-01',
      active_lot_id: '20000000-0000-4000-8000-000000000501',
      active_lot_code: 'CLI-BORDO-01',
      customer_name: 'Cliente Bordo E2E',
      progress_percent: 40,
    },
  },
};

function encodeJwt(persona) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: persona.userId,
    email: `sistema.${persona.key}@example.invalid`,
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    user_metadata: { name: `Sistema ${persona.cellName} E2E`, role: 'operator', cell: persona.cellName },
  })}.test-signature`;
}

function createSharedBackend() {
  const state = {
    activeByCell: new Map(Object.values(PERSONAS).map((persona) => [
      persona.cellName,
      { ...persona.activeContext },
    ])),
    receiptContextByCell: new Map(),
    contextConfirmations: [],
    ingested: [],
    seenDomainReads: new Set(),
    seenClientEventIds: new Set(),
    duplicateClientEventIds: [],
    loginCount: 0,
    inFlight: 0,
    maxInFlight: 0,
    inFlightByProfile: new Map(),
    maxInFlightByProfile: new Map(),
    queryCounts: { snapshot: 0, history: 0, historyCount: 0, shiftKpis: 0 },
    realtimeWebSockets: [],
  };

  const beginIngress = (profile) => {
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    const current = (state.inFlightByProfile.get(profile) || 0) + 1;
    state.inFlightByProfile.set(profile, current);
    state.maxInFlightByProfile.set(
      profile,
      Math.max(state.maxInFlightByProfile.get(profile) || 0, current),
    );
  };

  const endIngress = (profile) => {
    state.inFlight -= 1;
    state.inFlightByProfile.set(profile, (state.inFlightByProfile.get(profile) || 1) - 1);
  };

  return { state, beginIngress, endIngress };
}

function profileFor(persona) {
  return {
    id: persona.userId,
    email: `sistema.${persona.key}@example.invalid`,
    name: `Sistema ${persona.cellName} E2E`,
    role: 'operator',
    cell: persona.cellName,
    permissions: {
      view_dashboards: true,
      register_production: true,
      manage_occurrences: true,
      view_reports: true,
      view_traceability: true,
      view_replacements: true,
      manage_replacements: true,
    },
  };
}

function userFor(persona) {
  return {
    id: persona.userId,
    email: `sistema.${persona.key}@example.invalid`,
    aud: 'authenticated',
    role: 'authenticated',
    user_metadata: { name: `Sistema ${persona.cellName} E2E`, role: 'operator', cell: persona.cellName },
    app_metadata: { provider: 'email' },
    created_at: RECEIVED_AT_DB,
  };
}

function snapshotFor(backend, persona) {
  const active = backend.state.activeByCell.get(persona.cellName);
  return {
    state_version: `${persona.key}-${active.active_general_lot_code}`,
    lot_kpis: {
      expected: 100,
      approved: 20,
      rejected: 1,
      pending: 79,
      rework: 0,
      replacement: 0,
    },
    active_context: {
      cell_id: persona.cellId,
      cell_name: persona.cellName,
      machine_id: persona.machineId,
      ...active,
    },
    active_general_lots: [{
      id: active.active_pcp_import_batch_id,
      general_lot_code: active.active_general_lot_code,
      lot_id: active.active_lot_id,
      lot_code: active.active_lot_code,
      customer_name: active.customer_name,
      progress_percent: active.progress_percent,
    }],
  };
}

function resultFor(persona, active, event, decision) {
  const approved = decision === 'approved';
  return {
    success: approved,
    status: decision,
    message: approved ? 'Peça liberada pelo pipeline imediato.' : 'Leitura duplicada na mesma etapa.',
    quantity: event.quantity,
    client_event_id: event.client_event_id,
    committed_at: new Date().toISOString(),
    lot: {
      id: active.active_lot_id,
      lot_code: active.active_lot_code,
      pcp_import_batch_id: active.active_pcp_import_batch_id,
      general_lot_code: active.active_general_lot_code,
    },
    general_lot: {
      id: active.active_pcp_import_batch_id,
      general_lot_code: active.active_general_lot_code,
      progress_percent: active.progress_percent,
    },
    order: { customer_name: active.customer_name, order_number: `OP-${persona.key}` },
    step_code: persona.key === 'corte' ? 'cut' : 'edge',
    item: { id: `${persona.key}-${event.raw_value}`, piece_uid: event.raw_value, piece_name: 'Peça E2E',
      current_stage: persona.key === 'corte' ? 'edge' : 'separation',
      route_steps: ['cut', 'edge', 'separation'],
      completed_steps: persona.key === 'corte' ? ['cut'] : ['cut', 'edge'],
    },
    reading: { tag_value: event.raw_value, cell_name: persona.cellName },
  };
}

async function installBrowserObservers(context) {
  await context.addInitScript(() => {
    window.__collectionApprovalAudioStarts = 0;
    window.__collectionVibrations = 0;
    window.__collectionTerminalResults = [];
    window.addEventListener('collection-batch-result', (event) => {
      const detail = event.detail || {};
      if (!['APPROVED', 'REJECTED', 'BLOCKED', 'DUPLICATED', 'PENDING_REVIEW', 'DEAD_LETTERED']
        .includes(detail.state)) return;
      window.__collectionTerminalResults.push({
        state: detail.state,
        client_event_id: detail.event?.client_event_id || detail.result?.client_event_id || null,
        operator_session_id: detail.event?.operator_session_id
          || detail.event?.operatorSessionId
          || null,
      });
    });

    class FakeAudioContext {
      constructor() {
        this.currentTime = 0;
        this.destination = {};
      }

      createOscillator() {
        return {
          connect() {},
          frequency: { setValueAtTime() {} },
          onended: null,
          start() { window.__collectionApprovalAudioStarts += 1; },
          stop() { this.onended?.(); },
        };
      }

      createGain() {
        return {
          connect() {},
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        };
      }

      close() { return Promise.resolve(); }
    }

    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: () => {
        window.__collectionVibrations += 1;
        return true;
      },
    });
  });
}

function trackRealtimeWebSockets(page, backend, station) {
  page.on('websocket', (socket) => {
    if (/supabase[.]co\/realtime\/v1\/websocket/i.test(socket.url())) {
      backend.state.realtimeWebSockets.push({
        station,
        pageUrl: page.url(),
      });
    }
  });
}

function collectionRealtimeWebSockets(backend) {
  return backend.state.realtimeWebSockets.filter(({ pageUrl }) => /\/coleta(?:[/?#]|$)/.test(pageUrl));
}

async function installSupabaseMock(context, backend, persona, browserProfile) {
  const user = userFor(persona);
  const profile = profileFor(persona);

  await context.route('**://*.supabase.co/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const requestPath = url.pathname;
    const method = request.method();
    const headers = { 'content-type': 'application/json', 'content-range': '0-0/1' };
    const fulfill = (body, status = 200) => route.fulfill({
      status,
      headers,
      body: body == null ? '' : JSON.stringify(body),
    });

    if (requestPath.endsWith('/auth/v1/token')) {
      return fulfill({
        access_token: encodeJwt(persona),
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: `refresh-${browserProfile}`,
        user,
      });
    }
    if (requestPath.endsWith('/auth/v1/user')) return fulfill(user);
    if (requestPath.endsWith('/auth/v1/logout')) return fulfill(null, 204);
    if (requestPath.includes('/functions/v1/')) return fulfill({ success: true });

    if (requestPath.endsWith('/rest/v1/profiles')) {
      const wantsObject = request.headers().accept?.includes('object+json');
      return fulfill(wantsObject ? profile : [profile]);
    }
    if (requestPath.endsWith('/rest/v1/cells')) {
      return fulfill([{
        id: persona.cellId,
        name: persona.cellName,
        active: true,
        shift_hours: { shift1: 8, shift2: 8, shift3: 8 },
        notes: '',
      }]);
    }
    if (requestPath.endsWith('/rest/v1/production_machines')) {
      return fulfill([{
        id: persona.machineId,
        name: persona.machineName,
        station_name: persona.cellName,
        cell_name: persona.cellName,
        cell_id: persona.cellId,
        active: true,
      }]);
    }
    if (requestPath.endsWith('/rest/v1/rpc/operator_login_v2')) {
      const payload = request.postDataJSON();
      if (payload.p_login_name !== persona.login || payload.p_registration !== persona.registration) {
        return fulfill({ success: false, error: 'Credencial de teste inválida.' });
      }
      backend.state.loginCount += 1;
      const loginNumber = backend.state.loginCount;
      return fulfill({
        success: true,
        session_id: `${persona.key}-session-${loginNumber}`,
        session_token: `${persona.key}-token-${loginNumber}`,
        expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
        operator: {
          id: persona.operatorId,
          name: persona.name,
          login_name: persona.login,
          registration_masked: '***e2e',
          shift: '1º Turno',
          primary_cell_id: persona.cellId,
          primary_machine_id: persona.machineId,
          cells: [{ id: persona.cellId, name: persona.cellName, is_primary: true }],
          machines: [{
            id: persona.machineId,
            name: persona.machineName,
            cell_id: persona.cellId,
            cell_name: persona.cellName,
            is_primary: true,
          }],
        },
      });
    }
    if (requestPath.endsWith('/rest/v1/rpc/set_operator_session_context')) {
      const payload = request.postDataJSON();
      backend.state.contextConfirmations.push({ browserProfile, ...payload });
      return fulfill({
        success: true,
        cell_name: persona.cellName,
        machine_name: persona.machineName,
      });
    }
    if (requestPath.endsWith('/rest/v1/rpc/logout_operator_session')
      || requestPath.endsWith('/rest/v1/rpc/heartbeat_operator_session')) {
      return fulfill({
        success: true,
        expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      });
    }
    if (requestPath.endsWith('/rest/v1/rpc/get_collection_pipeline_flags_v3')) {
      return fulfill({
        collection_pipeline_v3_ingress: {
          enabled: true,
          rollout_scope: {
            all: true,
            immediate_rpc: 'ingest_collection_batch_immediate_v3',
            immediate_max_events: 5,
          },
        },
        collection_pipeline_v3_broadcast: { enabled: false, rollout_scope: { all: true } },
      });
    }
    if (requestPath.endsWith('/rest/v1/rpc/get_collection_dashboard_snapshot_v2')) {
      backend.state.queryCounts.snapshot += 1;
      return fulfill(snapshotFor(backend, persona));
    }
    if (requestPath.endsWith('/rest/v1/rpc/get_collection_history')) {
      backend.state.queryCounts.history += 1;
      return fulfill([]);
    }
    if (requestPath.endsWith('/rest/v1/rpc/get_collection_history_count')) {
      backend.state.queryCounts.historyCount += 1;
      return fulfill(0);
    }
    if (requestPath.endsWith('/rest/v1/rpc/get_operator_shift_kpis_v2')) {
      backend.state.queryCounts.shiftKpis += 1;
      return fulfill({ approved: 20, rejected: 1, blocked: 1 });
    }
    if (requestPath.endsWith('/rest/v1/rpc/ingest_collection_batch_immediate_v3')) {
      const payload = request.postDataJSON();
      const startedAt = performance.now();
      backend.beginIngress(browserProfile);
      // Mantém a chamada aberta por um instante para provar serialização entre
      // abas do mesmo dispositivo e paralelismo entre estações independentes.
      await new Promise((resolve) => setTimeout(resolve, 750));
      const active = backend.state.receiptContextByCell.get(persona.cellName)
        || backend.state.activeByCell.get(persona.cellName);
      const results = payload.p_events.events.map((event) => {
        if (backend.state.seenClientEventIds.has(event.client_event_id)) {
          backend.state.duplicateClientEventIds.push(event.client_event_id);
        }
        backend.state.seenClientEventIds.add(event.client_event_id);
        const domainKey = `${persona.cellName}:${event.raw_value}`;
        const decision = backend.state.seenDomainReads.has(domainKey) ? 'duplicated' : 'approved';
        backend.state.seenDomainReads.add(domainKey);
        return {
          client_event_id: event.client_event_id,
          persisted: true,
          received_at_db: RECEIVED_AT_DB,
          decision,
          decided_at: new Date().toISOString(),
          projection_status: 'pending',
          result: resultFor(persona, active, event, decision),
        };
      });
      backend.endIngress(browserProfile);
      backend.state.ingested.push({
        browserProfile,
        startedAt,
        endedAt: performance.now(),
        batchId: payload.p_batch_id,
        deviceId: payload.p_device_id,
        envelope: payload.p_events,
        results,
      });
      return fulfill({
        batch_id: payload.p_batch_id,
        device_id: payload.p_device_id,
        received_at_db: RECEIVED_AT_DB,
        results,
      });
    }
    if (requestPath.endsWith('/rest/v1/coletas_producao')) return fulfill([]);

    if (requestPath.startsWith('/rest/v1/')) {
      if (method === 'GET' || method === 'HEAD') return fulfill([]);
      const wantsObject = request.headers().accept?.includes('object+json');
      return fulfill(wantsObject ? {} : [{}]);
    }
    return fulfill({});
  });
}

async function loginSystem(page, persona) {
  await page.goto('login');
  await page.getByLabel(/E-mail Corporativo/i).fill(`sistema.${persona.key}@example.invalid`);
  await page.getByLabel('Senha').fill('credencial-sintetica-e2e');
  await page.getByRole('button', { name: /Entrar no Leo Flow/i }).click();
  await expect(page).toHaveURL(/\/ac-prod\/?$/);
}

async function loginOperator(page, persona) {
  await page.goto('coleta');
  await page.getByLabel('Nome/Login do operador').fill(persona.login);
  await page.getByLabel('Matrícula').fill(persona.registration);
  await page.getByRole('button', { name: 'Entrar na Produção' }).click();
  const scanner = page.getByLabel('Identificação produtiva');
  await expect(scanner).toBeEnabled({ timeout: 10_000 });
  // Em um navegador com várias páginas, o Playwright não garante que a aba
  // recém-autenticada seja a janela ativa. Foca explicitamente o campo como o
  // coletor físico faria antes de injetar os oito dígitos.
  await scanner.focus();
  await expect(scanner).toBeFocused();
  return scanner;
}

async function expectLot(page, context) {
  const banner = page.getByTestId('collection-lot-banner').first();
  await expect(banner).toContainText(context.active_general_lot_code);
  await expect(banner).toContainText(context.active_lot_code);
  await expect(banner).toContainText(context.customer_name);
}

async function feedbackState(page) {
  return page.locator('[role="status"][data-collection-state]').getAttribute('data-collection-state');
}

async function expectIntegrityMetric(page, label, value) {
  const panel = page.getByTestId('collection-integrity-panel');
  const card = panel.getByText(label, { exact: true }).locator('..');
  await expect(card).toContainText(String(value));
}

test('múltiplas estações isolam contexto, sincronizam lotes e não duplicam fatos sob concorrência', async ({ browser, baseURL }) => {
  const backend = createSharedBackend();
  const corteContext = await browser.newContext({ baseURL, locale: 'pt-BR' });
  const bordoContext = await browser.newContext({ baseURL, locale: 'pt-BR' });

  try {
    await installBrowserObservers(corteContext);
    await installBrowserObservers(bordoContext);
    await installSupabaseMock(corteContext, backend, PERSONAS.corte, 'workstation-corte');
    await installSupabaseMock(bordoContext, backend, PERSONAS.bordo, 'workstation-bordo');

    const corteA = await corteContext.newPage();
    trackRealtimeWebSockets(corteA, backend, 'corte-a');
    await loginSystem(corteA, PERSONAS.corte);
    const corteScannerA = await loginOperator(corteA, PERSONAS.corte);

    // Uma segunda aba do mesmo perfil compartilha device/localStorage/IndexedDB,
    // mas mantém uma sessão operacional própria em sessionStorage.
    const corteB = await corteContext.newPage();
    trackRealtimeWebSockets(corteB, backend, 'corte-b');
    const corteScannerB = await loginOperator(corteB, PERSONAS.corte);

    const bordo = await bordoContext.newPage();
    trackRealtimeWebSockets(bordo, backend, 'bordo');
    await loginSystem(bordo, PERSONAS.bordo);
    const bordoScanner = await loginOperator(bordo, PERSONAS.bordo);

    await Promise.all([
      expectLot(corteA, PERSONAS.corte.activeContext),
      expectLot(corteB, PERSONAS.corte.activeContext),
      expectLot(bordo, PERSONAS.bordo.activeContext),
    ]);

    // A confirmação de contexto é idempotente e pode ser repetida após uma
    // retomada/foco. A garantia relevante é que cada sessão distinta tenha o
    // posto certo confirmado pelo servidor.
    expect(new Set(backend.state.contextConfirmations.map((item) => item.p_session_token)).size).toBe(3);
    expect(new Set(backend.state.contextConfirmations.filter((item) => (
      item.p_cell_id === PERSONAS.corte.cellId && item.p_machine_id === PERSONAS.corte.machineId
    )).map((item) => item.p_session_token)).size).toBe(2);
    expect(new Set(backend.state.contextConfirmations.filter((item) => (
      item.p_cell_id === PERSONAS.bordo.cellId && item.p_machine_id === PERSONAS.bordo.machineId
    )).map((item) => item.p_session_token)).size).toBe(1);

    // Aguarda os efeitos de montagem/assinatura. O tráfego medido a seguir
    // pertence somente às decisões de coleta.
    await corteA.waitForTimeout(1_000);
    expect(collectionRealtimeWebSockets(backend)).toEqual([]);
    const queriesBeforeCollection = { ...backend.state.queryCounts };

    const capturedAt = performance.now();
    await Promise.all([
      corteScannerA.fill(PERSONAS.corte.code),
      corteScannerB.fill(PERSONAS.corte.code),
      bordoScanner.fill(PERSONAS.bordo.code),
    ]);

    await expect.poll(async () => {
      const states = await Promise.all([feedbackState(corteA), feedbackState(corteB)]);
      return states.sort();
    }, { timeout: 5_000 }).toEqual(['APPROVED', 'DUPLICATED']);
    await expect.poll(() => feedbackState(bordo), { timeout: 5_000 }).toBe('APPROVED');
    expect(performance.now() - capturedAt).toBeLessThan(5_000);

    const corteAState = await feedbackState(corteA);
    const approvedCortePage = corteAState === 'APPROVED' ? corteA : corteB;
    const duplicatedCortePage = corteAState === 'DUPLICATED' ? corteA : corteB;
    for (const [stationPage, code] of [
      [corteA, PERSONAS.corte.code],
      [corteB, PERSONAS.corte.code],
      [bordo, PERSONAS.bordo.code],
    ]) {
      await expect(stationPage.getByText(code, { exact: true }).first()).toBeVisible();
    }
    await expectIntegrityMetric(approvedCortePage, 'Aprovado', 21);
    await expectIntegrityMetric(approvedCortePage, 'Pendente', 78);
    await expectIntegrityMetric(bordo, 'Aprovado', 21);
    await expectIntegrityMetric(bordo, 'Pendente', 78);
    await expect(bordo.getByText('Produzido no turno', { exact: true }).locator('..')).toContainText('22');
    await expect(duplicatedCortePage.getByText('Produzido no turno', { exact: true }).locator('..')).toContainText('21');
    await expect(bordo.getByText('Etapa da leitura: Bordo', { exact: true })).toBeVisible();
    await expect(bordo.getByText('Etapa atual da peça: Separação', { exact: true })).toBeVisible();

    // A aba que adquiriu o lock pode transportar o evento da aba irmã, mas
    // cada interface deve receber apenas a decisão de sua própria sessão.
    const [corteATerminals, corteBTerminals, bordoTerminals] = await Promise.all([
      corteA.evaluate(() => window.__collectionTerminalResults),
      corteB.evaluate(() => window.__collectionTerminalResults),
      bordo.evaluate(() => window.__collectionTerminalResults),
    ]);
    expect(corteATerminals).toEqual([expect.objectContaining({
      operator_session_id: 'corte-session-1',
    })]);
    expect(corteBTerminals).toEqual([expect.objectContaining({
      operator_session_id: 'corte-session-2',
    })]);
    expect(bordoTerminals).toEqual([expect.objectContaining({
      operator_session_id: 'bordo-session-3',
      state: 'APPROVED',
    })]);
    await expect.poll(() => approvedCortePage.evaluate(() => ({
      audio: window.__collectionApprovalAudioStarts,
      vibrations: window.__collectionVibrations,
    }))).toEqual({ audio: 1, vibrations: 1 });
    await expect.poll(() => duplicatedCortePage.evaluate(() => ({
      audio: window.__collectionApprovalAudioStarts,
      vibrations: window.__collectionVibrations,
    }))).toEqual({ audio: 0, vibrations: 0 });
    await expect.poll(() => bordo.evaluate(() => ({
      audio: window.__collectionApprovalAudioStarts,
      vibrations: window.__collectionVibrations,
    }))).toEqual({ audio: 1, vibrations: 1 });

    for (const stationPage of [corteA, corteB, bordo]) {
      await expect(stationPage.locator('[data-sonner-toast]').filter({
        hasText: /aguardando (registro|validação|processamento)/i,
      })).toHaveCount(0);
    }
    await corteA.waitForTimeout(1_000);
    expect(backend.state.queryCounts).toEqual(queriesBeforeCollection);

    const ingestedEvents = backend.state.ingested.flatMap((call) => call.envelope.events.map((event) => ({
      ...event,
      operatorSessionId: call.envelope.operator_session_id,
      deviceId: call.deviceId,
      browserProfile: call.browserProfile,
    })));
    expect(ingestedEvents).toHaveLength(3);
    expect(new Set(ingestedEvents.map((event) => event.client_event_id)).size).toBe(3);
    expect(backend.state.duplicateClientEventIds).toEqual([]);
    expect(backend.state.seenDomainReads).toEqual(new Set([
      `${PERSONAS.corte.cellName}:${PERSONAS.corte.code}`,
      `${PERSONAS.bordo.cellName}:${PERSONAS.bordo.code}`,
    ]));

    const corteEvents = ingestedEvents.filter((event) => event.browserProfile === 'workstation-corte');
    expect(corteEvents).toHaveLength(2);
    expect(new Set(corteEvents.map((event) => event.deviceId)).size).toBe(1);
    expect(new Set(corteEvents.map((event) => event.device_sequence)).size).toBe(2);
    expect(new Set(corteEvents.map((event) => event.operatorSessionId)).size).toBe(2);
    expect(backend.state.maxInFlightByProfile.get('workstation-corte')).toBe(1);
    expect(backend.state.maxInFlight).toBeGreaterThanOrEqual(2);

    // A decisão imediata já mudou o cliente, mas a projeção do banco ainda
    // aponta o anterior. Até um GET iniciado depois do ACK deve preservá-lo.
    const immediateContext = { ...PERSONAS.corte.activeContext,
      active_lot_id: '10000000-0000-4000-8000-000000000503',
      active_lot_code: 'CLI-CORTE-IMEDIATO', customer_name: 'Cliente Imediato E2E' };
    backend.state.receiptContextByCell.set(PERSONAS.corte.cellName, immediateContext);
    await approvedCortePage.getByLabel('Identificação produtiva').fill('09950102');
    await expect.poll(() => feedbackState(approvedCortePage)).toBe('APPROVED');
    await expectLot(approvedCortePage, immediateContext);
    const snapshotsBeforeStaleGet = backend.state.queryCounts.snapshot;
    await approvedCortePage.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await expect.poll(() => backend.state.queryCounts.snapshot).toBeGreaterThan(snapshotsBeforeStaleGet);
    await expectLot(approvedCortePage, immediateContext);
    await expectIntegrityMetric(approvedCortePage, 'Aprovado', 22);

    // Troca autoritativa de lote após uma leitura já confirmada: o snapshot
    // atual deve superar o feedback local antigo nos modos normal e foco.
    const nextContext = {
      active_pcp_import_batch_id: '10000000-0000-4000-8000-000000000402',
      active_general_lot_code: 'GER-CORTE-02',
      active_lot_id: '10000000-0000-4000-8000-000000000502',
      active_lot_code: 'CLI-CORTE-02',
      customer_name: 'Cliente Corte Atualizado E2E',
      progress_percent: 5,
      source_client_event_id: 'newer-station-event',
      last_event_occurred_at: new Date().toISOString(),
    };
    backend.state.activeByCell.set(PERSONAS.corte.cellName, nextContext);
    const snapshotsBeforeContextSwitch = backend.state.queryCounts.snapshot;
    await corteA.bringToFront();
    await expect.poll(() => corteA.evaluate(() => document.visibilityState)).toBe('visible');
    await corteA.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => backend.state.queryCounts.snapshot, { timeout: 5_000 })
      .toBeGreaterThan(snapshotsBeforeContextSwitch);
    await expectLot(corteA, nextContext);
    await corteA.waitForTimeout(1_000);
    const queriesBeforeKiosk = { ...backend.state.queryCounts };

    await corteA.getByRole('button', { name: /Modo Foco/i }).click();
    const kiosk = corteA.getByTestId('collection-fullscreen-kiosk');
    await expect(kiosk).toBeVisible();
    const kioskBanner = kiosk.getByTestId('collection-lot-banner');
    await expect(kioskBanner).toContainText(nextContext.active_general_lot_code);
    await expect(kioskBanner).toContainText(nextContext.active_lot_code);
    await expect(kioskBanner).toContainText(nextContext.customer_name);
    await corteA.waitForTimeout(1_000);
    expect(backend.state.queryCounts).toEqual(queriesBeforeKiosk);

    // Uma reconciliação compacta do mesmo lote pode omitir seus nomes; ela
    // continua atualizando as métricas sem apagar a identidade já confirmada.
    backend.state.activeByCell.set(PERSONAS.corte.cellName, {
      ...nextContext, active_general_lot_code: null, customer_name: null,
    });
    await kiosk.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await expect.poll(() => backend.state.queryCounts.snapshot).toBeGreaterThan(queriesBeforeKiosk.snapshot);
    await expect(kioskBanner).toContainText(nextContext.active_general_lot_code);
    await expect(kioskBanner).toContainText(nextContext.customer_name);

    // O contexto da outra célula não sofre vazamento quando Corte troca lote.
    await expectLot(bordo, PERSONAS.bordo.activeContext);
    expect(collectionRealtimeWebSockets(backend)).toEqual([]);
  } finally {
    await Promise.allSettled([corteContext.close(), bordoContext.close()]);
  }
});
