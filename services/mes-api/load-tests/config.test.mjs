import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLoadConfig } from './config.mjs';

const fixture = {
  MES_LOADTEST_API_TOKEN: 'load-test-token-with-at-least-32-characters',
  MES_LOADTEST_EQUIPAMENTO_ID: '11111111-1111-4111-8111-111111111111',
  MES_LOADTEST_PRODUTO_ID: '22222222-2222-4222-8222-222222222222',
};

test('carga aceita somente loopback por padrão', () => {
  assert.equal(readLoadConfig(fixture).origin, 'http://127.0.0.1:3000');
  assert.equal(readLoadConfig(fixture).rate, 40);
  for (const origin of ['https://ac-prod-api.onrender.com', 'https://staging.example.com',
    'https://db.example.supabase.co', 'https://user:pass@localhost',
    'http://localhost/api', 'http://localhost?host=production', 'http://localhost:99999']) {
    assert.throws(() => readLoadConfig({ ...fixture, MES_LOADTEST_BASE_URL: origin }));
  }
});

test('opt-in remoto não libera produção ou Supabase', () => {
  const remote = { ...fixture, MES_LOADTEST_ALLOW_REMOTE_STAGING: 'yes' };
  assert.equal(readLoadConfig({ ...remote, MES_LOADTEST_BASE_URL: 'https://mes-staging.example.com' }).rate, 40);
  for (const origin of ['https://ac-prod-api.onrender.com', 'https://test.supabase.co',
    'https://test.prod.example.com', 'http://staging.example.com', 'https://api.example.com']) {
    assert.throws(() => readLoadConfig({ ...remote, MES_LOADTEST_BASE_URL: origin }));
  }
});

test('faltas e limites não viram uma carga silenciosamente diferente', () => {
  assert.throws(() => readLoadConfig({ ...fixture, MES_LOADTEST_API_TOKEN: '' }));
  assert.throws(() => readLoadConfig({ ...fixture, MES_LOADTEST_PRODUTO_ID: 'produto-real' }));
  assert.throws(() => readLoadConfig({ ...fixture, MES_LOADTEST_DURATION_SECONDS: '0' }));
  assert.throws(() => readLoadConfig({ ...fixture, MES_LOADTEST_RATE: '1001' }));
});
