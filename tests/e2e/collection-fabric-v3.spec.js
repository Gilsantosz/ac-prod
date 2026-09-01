import { expect, test } from 'playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const userId = '00000000-0000-4000-8000-000000000001';
const receivedAtDb = '2026-06-19T11:00:00.000Z';

const MIME_TYPES = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

async function serveStaticBuild(page) {
  if (!process.env.PLAYWRIGHT_STATIC_DIST) return;
  const dist = path.resolve(process.cwd(), 'dist');
  // A CSP de produção contém upgrade-insecure-requests. Interceptar os dois
  // protocolos mantém o harness fiel ao build e evita assets em branco quando
  // o documento HTTP promove módulos/estilos para HTTPS.
  await page.route(/^https?:\/\/app[.]test\//, async (route) => {
    const url = new URL(route.request().url());
    let relativePath = decodeURIComponent(url.pathname).replace(/^\/ac-prod\/?/, '');
    if (!relativePath || !path.extname(relativePath)) relativePath = 'index.html';
    relativePath = relativePath.replace(/^\/+/, '');
    const filePath = path.resolve(dist, relativePath);
    if (filePath !== dist && !filePath.startsWith(`${dist}${path.sep}`)) {
      await route.fulfill({ status: 403, body: 'Forbidden' });
      return;
    }
    try {
      const body = await fs.readFile(filePath);
      await route.fulfill({
        status: 200,
        contentType: MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
        body,
      });
    } catch {
      await route.fulfill({ status: 404, body: 'Not found' });
    }
  });
}

function jwt() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: userId,
    email: 'operador.teste@leo.com.br',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    user_metadata: { name: 'Operador Teste', role: 'operator', cell: 'Corte' },
  })}.test-signature`;
}

async function installBrowserObservers(page) {
  await page.addInitScript(() => {
    window.__collectionApprovalAudioStarts = 0;
    window.__collectionVibrations = 0;

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
          gain: {
            setValueAtTime() {},
            exponentialRampToValueAtTime() {},
          },
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

    // Mantém a semântica da reconciliação, reduzindo apenas a espera do
    // cenário determinístico. O registro ACK usa received_at_db antigo e já
    // satisfaz o limiar de staleness quando o servidor liberar a decisão.
    const nativeSetInterval = window.setInterval.bind(window);
    window.setInterval = (callback, timeout, ...args) => nativeSetInterval(
      callback,
      timeout === 15_000 ? 200 : timeout,
      ...args,
    );
  });
}

async function mockCollectionV3(page) {
  const state = {
    finalize: false,
    ingestedEnvelope: null,
    ingestedDeviceId: null,
    clientEventIds: [],
  };
  const user = {
    id: userId,
    email: 'operador.teste@leo.com.br',
    aud: 'authenticated',
    role: 'authenticated',
    user_metadata: { name: 'Operador Teste', role: 'operator', cell: 'Corte' },
    app_metadata: { provider: 'email' },
    created_at: receivedAtDb,
  };
  const profile = {
    id: userId,
    email: user.email,
    name: 'Operador Teste',
    role: 'operator',
    cell: 'Corte',
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

  await page.route('**://*.supabase.co/**', async (route) => {
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
        access_token: jwt(),
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'refresh-token-test',
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
        id: 'cell-cut',
        name: 'Corte',
        active: true,
        shift_hours: { shift1: 8, shift2: 8, shift3: 8 },
        notes: '',
      }]);
    }
    if (requestPath.endsWith('/rest/v1/rpc/operator_login_v2')) {
      return fulfill({
        success: true,
        session_id: 'operator-session-test',
        session_token: 'operator-token-v2-only',
        expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
        operator: {
          id: 'operator-test',
          name: 'Operador Teste',
          login_name: 'operador.teste',
          registration_masked: '***123',
          shift: '1º Turno',
          primary_cell_id: 'cell-cut',
          primary_machine_id: null,
          cells: [{ id: 'cell-cut', name: 'Corte', is_primary: true }],
          machines: [],
        },
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
          rollout_scope: { all: true },
        },
        collection_pipeline_v3_broadcast: {
          enabled: false,
          rollout_scope: { all: true },
        },
      });
    }
    if (requestPath.endsWith('/rest/v1/rpc/ingest_collection_batch_v3')) {
      const payload = request.postDataJSON();
      state.ingestedEnvelope = payload.p_events;
      state.ingestedDeviceId = payload.p_device_id;
      state.clientEventIds = payload.p_events.events.map((event) => event.client_event_id);
      return fulfill({
        batch_id: payload.p_batch_id,
        device_id: payload.p_device_id,
        received_at_db: receivedAtDb,
        results: state.clientEventIds.map((clientEventId) => ({
          client_event_id: clientEventId,
          persisted: true,
          received_at_db: receivedAtDb,
        })),
      });
    }
    if (requestPath.endsWith('/rest/v1/coletas_producao')) {
      if (!state.finalize) return fulfill([]);
      return fulfill(state.clientEventIds.map((clientEventId) => ({
        client_event_id: clientEventId,
        status_sincronizacao: 'sincronizada',
        resultado: {
          client_event_id: clientEventId,
          collection_state: 'APPROVED',
          status: 'approved',
          success: true,
          message: 'Leitura aprovada pelo pipeline V3.',
        },
        erro: null,
        retryable: false,
        batch_id: 'batch-v3-e2e',
        received_at_db: receivedAtDb,
        server_received_at: receivedAtDb,
        processado_em: new Date().toISOString(),
        last_error_code: null,
      })));
    }

    if (requestPath.startsWith('/rest/v1/')) {
      if (method === 'GET' || method === 'HEAD') return fulfill([]);
      const wantsObject = request.headers().accept?.includes('object+json');
      return fulfill(wantsObject ? {} : [{}]);
    }
    return fulfill({});
  });

  return state;
}

test('offline e ACK permanecem neutros até APPROVED após a reconexão', async ({ page, context }) => {
  await serveStaticBuild(page);
  await installBrowserObservers(page);
  const state = await mockCollectionV3(page);

  await page.goto('login');
  await page.getByLabel(/E-mail Corporativo/i).fill('operador.teste@leo.com.br');
  await page.getByLabel('Senha').fill('SenhaTeste123!');
  await page.getByRole('button', { name: /Entrar no Leo Flow/i }).click();
  await expect(page).toHaveURL(/\/ac-prod\/?$/);

  await page.goto('entrada?modo=coleta');
  await page.getByLabel('Nome/Login do operador').fill('operador.teste');
  await page.getByLabel('Matrícula').fill('00123');
  await page.getByRole('button', { name: 'Entrar na Produção' }).click();
  const scanner = page.getByLabel('Identificação produtiva');
  await expect(scanner).toBeFocused();

  await context.setOffline(true);
  await scanner.fill('09950001');

  const feedback = page.locator('[role="status"][data-collection-state]');
  await expect(feedback).toHaveAttribute('data-collection-state', 'CAPTURED_LOCAL');
  await expect(feedback).not.toHaveClass(/border-emerald-300/);
  await expect(page.getByText('PEÇA LIBERADA — OK')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__collectionApprovalAudioStarts)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__collectionVibrations)).toBe(0);

  await context.setOffline(false);
  await expect(feedback).toHaveAttribute(
    'data-collection-state',
    'DATABASE_ACKNOWLEDGED',
    { timeout: 10_000 },
  );
  await expect(feedback).not.toHaveClass(/border-emerald-300/);
  await expect(page.getByText('PEÇA LIBERADA — OK')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__collectionApprovalAudioStarts)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__collectionVibrations)).toBe(0);

  expect(state.ingestedEnvelope).toMatchObject({
    operator_session_id: 'operator-session-test',
    source_mode: 'offline_replay',
    events: [{
      raw_value: '09950001',
      tag_lida: '09950001',
      reader_type: 'keyboard_barcode',
      device_sequence: expect.any(Number),
      quantity: 1,
    }],
  });
  expect(state.ingestedEnvelope.events).toHaveLength(1);
  expect(state.ingestedDeviceId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  expect(JSON.stringify(state.ingestedEnvelope)).not.toMatch(/token|jwt|authorization/i);

  state.finalize = true;
  await expect(feedback).toHaveAttribute(
    'data-collection-state',
    'APPROVED',
    { timeout: 10_000 },
  );
  await expect(feedback).toHaveClass(/border-emerald-300/);
  await expect(page.getByText('PEÇA LIBERADA — OK')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__collectionApprovalAudioStarts)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__collectionVibrations)).toBe(1);
});
