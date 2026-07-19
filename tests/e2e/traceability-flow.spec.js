import { expect, test } from 'playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const userId = '00000000-0000-4000-8000-000000000001';
const now = '2026-06-19T11:00:00.000Z';
const lot = {
  id: 'lot-test-001',
  lot_code: 'LSM-TEST-001',
  status: 'in_progress',
  current_status: 'Em produção',
  progress_percent: 20,
  order_number: 'OP-TEST-001',
  customer_name: 'Cliente Teste',
};
const item = {
  id: 'item-001',
  item_code: 'P001',
  product_name: 'Porta Pivotante Teste',
  status: 'in_progress',
  current_step: 'Corte',
};
const routeStep = { id: 'route-cut', step_name: 'Corte', cell_name: 'Corte', step_order: 1 };
const trackingStages = [
  { stage_code: 'cut', stage_label: 'Corte', stage_order: 1, required_pieces: 30, completed_pieces: 12, remaining_pieces: 18, progress_percent: 40, estimated_remaining_minutes: 36 },
  { stage_code: 'edge', stage_label: 'Borda', stage_order: 2, required_pieces: 30, completed_pieces: 2, remaining_pieces: 28, progress_percent: 6.67, estimated_remaining_minutes: 84 },
  { stage_code: 'cnc', stage_label: 'Usinagem', stage_order: 3, required_pieces: 10, completed_pieces: 0, remaining_pieces: 10, progress_percent: 0, estimated_remaining_minutes: 50 },
  { stage_code: 'joinery', stage_label: 'Marcenaria', stage_order: 4, required_pieces: 2, completed_pieces: 0, remaining_pieces: 2, progress_percent: 0, estimated_remaining_minutes: 40 },
];
const generalLotTracking = {
  generated_at: now,
  model_window_days: 90,
  prediction_target: 'ready_for_separation',
  stage_models: trackingStages.map((stage, index) => ({
    stage_code: stage.stage_code,
    stage_label: stage.stage_label,
    stage_order: stage.stage_order,
    sample_count: index === 0 ? 211 : 1,
    observed_days: index === 0 ? 1 : 0,
    minutes_per_piece: [2.06, 3, 5, 20][index],
    p80_minutes_per_piece: [2.06, 3.75, 6.25, 25][index],
    confidence: index === 0 ? 'medium' : 'low',
    model_source: index === 0 ? 'learned' : 'baseline',
  })),
  general_lots: [{
    batch_id: 'batch-15587',
    general_lot_code: '15587',
    file_name: '15587-teste.xlsx',
    status: 'processed',
    total_pieces: 60,
    ready_for_separation_pieces: 0,
    total_operations: 144,
    completed_operations: 26,
    progress_percent: 18.06,
    client_lots_count: 2,
    customers_count: 1,
    blocked_pieces: 0,
    rework_pieces: 0,
    replacement_pieces: 0,
    integrity_percent: 100,
    stages: trackingStages,
    bottleneck_stage: 'Borda',
    estimated_remaining_minutes: 210,
    predicted_ready_at: '2026-06-19T14:30:00.000Z',
    forecast_confidence: 'low',
    forecast_status: 'on_track',
    client_lots: [],
  }],
};

function trackingPayload(includeClientLots) {
  if (!includeClientLots) return generalLotTracking;
  const clientLots = ['143332', '143403'].map((lotCode, index) => ({
    lot_id: `client-lot-${index + 1}`,
    lot_code: lotCode,
    customer_name: 'MARINA MARIA PASETTI DE SOUZA CATANZARO',
    status: 'in_progress',
    current_stage: 'cut',
    total_pieces: 30,
    ready_for_separation_pieces: 0,
    total_operations: 72,
    completed_operations: 13,
    progress_percent: 18.06,
    blocked_pieces: 0,
    rework_pieces: 0,
    replacement_pieces: 0,
    integrity_percent: 100,
    stages: trackingStages,
    bottleneck_stage: 'Borda',
    estimated_remaining_minutes: 105,
    predicted_ready_at: '2026-06-19T12:45:00.000Z',
    forecast_confidence: 'low',
    forecast_status: 'on_track',
    ready_for_separation: false,
  }));
  return {
    ...generalLotTracking,
    general_lots: [{ ...generalLotTracking.general_lots[0], client_lots }],
  };
}

const MIME_TYPES = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
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
  await page.route('http://app.test/**', async (route) => {
    const url = new URL(route.request().url());
    let relativePath = decodeURIComponent(url.pathname).replace(/^\/ac-prod\/?/, '');
    if (!relativePath || !path.extname(relativePath)) relativePath = 'index.html';
    const filePath = path.resolve(dist, relativePath);
    if (!filePath.startsWith(dist)) return route.fulfill({ status: 403, body: 'Forbidden' });
    try {
      const body = await fs.readFile(filePath);
      return route.fulfill({
        status: 200,
        contentType: MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
        body,
      });
    } catch {
      return route.fulfill({ status: 404, body: 'Not found' });
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

async function mockSupabase(page) {
  const state = { readings: [], processCount: 0, entries: [], occurrenceCreated: false };
  const user = {
    id: userId,
    email: 'operador.teste@leo.com.br',
    aud: 'authenticated',
    role: 'authenticated',
    user_metadata: { name: 'Operador Teste', role: 'operator', cell: 'Corte' },
    app_metadata: { provider: 'email' },
    created_at: now,
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
    },
  };

  await page.route('**://*.supabase.co/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const headers = { 'content-type': 'application/json', 'content-range': '0-0/1' };
    const fulfill = (body, status = 200) => route.fulfill({ status, headers, body: body == null ? '' : JSON.stringify(body) });

    if (path.endsWith('/auth/v1/token')) {
      return fulfill({
        access_token: jwt(),
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'refresh-token-test',
        user,
      });
    }
    if (path.endsWith('/auth/v1/user')) return fulfill(user);
    if (path.endsWith('/auth/v1/logout')) return fulfill(null, 204);
    if (path.includes('/functions/v1/')) return fulfill({ success: true });

    if (path.endsWith('/rest/v1/profiles')) {
      const wantsObject = request.headers().accept?.includes('object+json');
      return fulfill(wantsObject ? profile : [profile]);
    }
    if (path.endsWith('/rest/v1/cells')) {
      return fulfill([{
        id: 'cell-cut', name: 'Corte', active: true, shift_hours: { shift1: 8, shift2: 8, shift3: 8 }, notes: '',
      }]);
    }
    if (path.endsWith('/rest/v1/daily_goals')) return fulfill([]);
    if (path.endsWith('/rest/v1/production_entries')) {
      if (method === 'POST') {
        const entry = { id: `entry-${state.entries.length + 1}`, created_at: now, ...request.postDataJSON() };
        state.entries.push(entry);
        return fulfill(entry);
      }
      return fulfill(state.entries);
    }
    if (path.endsWith('/rest/v1/production_routes')) {
      return fulfill([
        routeStep,
        { id: 'route-joinery', step_name: 'Marcenaria', cell_name: 'Marcenaria', step_order: 2 },
      ]);
    }
    if (path.endsWith('/rest/v1/production_stage_readings')) return fulfill(state.readings);

    if (path.endsWith('/rest/v1/rpc/get_general_lot_tracking')) {
      return fulfill(trackingPayload(Boolean(request.postDataJSON()?.p_batch_id)));
    }

    if (path.endsWith('/rest/v1/rpc/process_production_reading')) {
      const payload = request.postDataJSON()?.p_payload || {};
      state.processCount += 1;
      if (payload.rawValue === 'LSM-TEST-001-WRONG') {
        return fulfill({
          success: false,
          status: 'wrong_step',
          message: 'Etapa esperada: Marcenaria.',
          lot,
          item: { ...item, current_step: 'Marcenaria' },
          route: { id: 'route-joinery', step_name: 'Marcenaria', cell_name: 'Marcenaria' },
          reading: null,
          nextStep: null,
          occurrence: null,
          kpiUpdate: { total: 1, approved: 0, rejected: 0, blocked: 1 },
        });
      }
      if (state.processCount > 1) {
        return fulfill({
          success: false,
          status: 'duplicated',
          message: 'Esta peça já foi baixada nesta etapa.',
          lot,
          item,
          route: routeStep,
          reading: state.readings[0],
          nextStep: null,
          occurrence: null,
          kpiUpdate: { total: 1, approved: 0, rejected: 0, blocked: 1 },
        });
      }
      const reading = {
        id: 'reading-approved-001',
        tag_value: payload.rawValue,
        reader_type: payload.readerType,
        step_name: 'Corte',
        cell_name: 'Corte',
        operator: 'Operador Teste',
        quantity: 1,
        status: 'approved',
        created_at: now,
      };
      state.readings.unshift(reading);
      return fulfill({
        success: true,
        status: 'approved',
        message: 'Leitura aprovada. Próxima etapa: Marcenaria.',
        lot,
        item: { ...item, current_step: 'Marcenaria' },
        route: routeStep,
        reading,
        nextStep: { id: 'route-joinery', step_name: 'Marcenaria', cell_name: 'Marcenaria' },
        occurrence: null,
        kpiUpdate: { total: 1, approved: 1, rejected: 0, blocked: 0 },
      });
    }

    if (path.endsWith('/rest/v1/rpc/register_traceability_rejection')) {
      state.occurrenceCreated = true;
      const reading = {
        id: 'reading-rejected-001',
        tag_value: 'LSM-TEST-001-WRONG',
        reader_type: 'keyboard_barcode',
        step_name: 'Marcenaria',
        cell_name: 'Corte',
        operator: 'Operador Teste',
        quantity: 1,
        status: 'rejected',
        created_at: now,
      };
      state.readings.unshift(reading);
      return fulfill({
        success: false,
        status: 'rejected',
        message: 'Ocorrência registrada e peça bloqueada.',
        lot,
        item: { ...item, status: 'rejected' },
        route: routeStep,
        reading,
        nextStep: null,
        occurrence: { id: 'occurrence-test-001', status: 'open' },
        kpiUpdate: { total: 1, approved: 0, rejected: 1, blocked: 0 },
      });
    }

    if (path.startsWith('/rest/v1/')) {
      if (method === 'GET' || method === 'HEAD') return fulfill([]);
      const wantsObject = request.headers().accept?.includes('object+json');
      return fulfill(wantsObject ? {} : [{}]);
    }
    return fulfill({});
  });

  return state;
}

test('fluxo principal de entrada e rastreabilidade produtiva', async ({ page }) => {
  await serveStaticBuild(page);
  const state = await mockSupabase(page);
  await page.goto('login');

  await page.getByLabel('E-mail').fill('operador.teste@leo.com.br');
  await page.getByLabel('Senha').fill('SenhaTeste123!');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/ac-prod\/?$/);

  await page.goto('entrada');
  await expect(page.getByRole('heading', { name: 'Apontamento MES' })).toBeVisible();
  await page.locator('#quick-produced').fill('10');
  await page.getByRole('button', { name: 'Registrar Produção' }).click();
  await expect(page.getByText('Produção registrada')).toBeVisible();
  expect(state.entries).toHaveLength(1);

  await page.getByRole('tab', { name: 'Coleta Código / RFID' }).click();
  const scanner = page.getByLabel('Identificação produtiva');
  await expect(scanner).toBeFocused();
  await scanner.fill('LSM-TEST-001-P001');
  await scanner.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Leitura aprovada' })).toBeVisible();

  await scanner.fill('LSM-TEST-001-P001');
  await scanner.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'já foi baixada' })).toBeVisible();

  await scanner.fill('LSM-TEST-001-WRONG');
  await scanner.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Etapa esperada' })).toBeVisible();

  await page.getByRole('button', { name: 'Registrar Ocorrência / Reprovar Peça' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Observação').fill('Avaria identificada no teste E2E');
  await page.getByRole('button', { name: 'Reprovar e criar ocorrência' }).click();
  await expect(page.getByText('Ocorrência registrada e peça bloqueada.').first()).toBeVisible();
  expect(state.occurrenceCreated).toBe(true);

  await expect(page.getByText('LSM-TEST-001', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Últimas leituras')).toBeVisible();
  await expect(page.getByText('Leituras hoje')).toBeVisible();
  await expect(page.getByText('Reprovadas')).toBeVisible();
  expect(state.readings).toHaveLength(2);
});

test('exibe lote geral antes dos lotes de clientes e abre o dashboard preditivo', async ({ page }) => {
  await serveStaticBuild(page);
  await mockSupabase(page);
  await page.goto('login');

  await page.getByLabel('E-mail').fill('operador.teste@leo.com.br');
  await page.getByLabel('Senha').fill('SenhaTeste123!');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await page.goto('integridade-lote');
  await expect(page.getByRole('heading', { name: 'Painel de Integridade de Lote' })).toBeVisible();
  await expect(page.getByText('Lote geral')).toBeVisible();
  await expect(page.getByText('15587', { exact: true })).toBeVisible();
  await expect(page.getByText('143332', { exact: true })).toBeVisible();
  await expect(page.getByText('143403', { exact: true })).toBeVisible();
  await expect(page.getByText('2 lotes na mesma capa')).toBeVisible();

  await page.goto('acompanhamento-lotes');
  await expect(page.getByRole('heading', { name: 'Acompanhamento e Previsão de Lotes' })).toBeVisible();
  await expect(page.getByText('O prazo mostrado termina antes da embalagem')).toBeVisible();
  await expect(page.getByText('Tempo aprendido por etapa')).toBeVisible();
  await expect(page.getByText('Prontas para separação')).toBeVisible();
});
