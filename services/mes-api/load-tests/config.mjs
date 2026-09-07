// Compartilhado pelo k6 e pelos testes Node. Não lê .env nem DATABASE_URL.
export function readLoadConfig(env) {
  function integer(name, fallback, max) {
    const raw = env[name] ?? String(fallback);
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max) {
      throw new Error(`${name}: inteiro entre 1 e ${max}.`);
    }
    return Number(raw);
  }

  const origin = env.MES_LOADTEST_BASE_URL || 'http://127.0.0.1:3000';
  // Apenas uma origem explícita: sem credenciais, caminho, query ou redirects.
  const parts = /^(https?):\/\/(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::([0-9]+))?\/?$/i.exec(origin);
  if (!parts || (parts[3] && (Number(parts[3]) < 1 || Number(parts[3]) > 65535))) {
    throw new Error('MES_LOADTEST_BASE_URL deve ser uma origem HTTP(S), sem credenciais ou caminho.');
  }
  const hostname = parts[2].toLowerCase();
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
  if (!loopback) {
    const supabase = /(^|\.)supabase\.(co|com)$/.test(hostname);
    const production = /(^|[.-])(prod|production)([.-]|$)/.test(hostname);
    const staging = /(^|[.-])(staging|stage|test|testing|preview)([.-]|$)/.test(hostname);
    if (supabase || production || !staging || parts[1].toLowerCase() !== 'https'
        || env.MES_LOADTEST_ALLOW_REMOTE_STAGING !== 'yes'
        || !env.MES_LOADTEST_BASE_URL) {
      throw new Error('Carga remota recusada: exige HTTPS, hostname de staging/test/preview e MES_LOADTEST_ALLOW_REMOTE_STAGING=yes. Produção e Supabase são recusados.');
    }
  }

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(env.MES_LOADTEST_EQUIPAMENTO_ID || '')
      || !uuid.test(env.MES_LOADTEST_PRODUTO_ID || '')) {
    throw new Error('Informe UUIDs de equipamento e produto exclusivos do ambiente de teste.');
  }
  if (!env.MES_LOADTEST_API_TOKEN || env.MES_LOADTEST_API_TOKEN.length < 32
      || /\s/.test(env.MES_LOADTEST_API_TOKEN)) {
    throw new Error('MES_LOADTEST_API_TOKEN deve conter pelo menos 32 caracteres sem espaços.');
  }
  return {
    origin: origin.replace(/\/$/, ''),
    token: env.MES_LOADTEST_API_TOKEN,
    equipamento: env.MES_LOADTEST_EQUIPAMENTO_ID.toLowerCase(),
    produto: env.MES_LOADTEST_PRODUTO_ID.toLowerCase(),
    rate: integer('MES_LOADTEST_RATE', 40, 1000),
    seconds: integer('MES_LOADTEST_DURATION_SECONDS', 60, 1800),
    p95: integer('MES_LOADTEST_P95_MS', 500, 30000),
    vus: integer('MES_LOADTEST_VUS', 100, 1000),
  };
}
