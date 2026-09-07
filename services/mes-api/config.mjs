import { readFileSync } from 'node:fs';

function integer(env, name, fallback, min = 1, max = 2_147_483_647) {
  const raw = env[name] ?? String(fallback);
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name}: esperado inteiro entre ${min} e ${max}.`);
  }
  return value;
}

export function loadConfig(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória.');
  let databaseUrl;
  try { databaseUrl = new URL(env.DATABASE_URL); }
  catch { throw new Error('DATABASE_URL inválida.'); }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('DATABASE_URL deve usar PostgreSQL.');
  }

  const production = env.NODE_ENV === 'production';
  const permittedParameters = new Set(['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat', 'pgbouncer']);
  if ([...databaseUrl.searchParams.keys()].some((key) => !permittedParameters.has(key))) {
    throw new Error('DATABASE_URL contém parâmetros não suportados. Utilize a URL do pooler sem opções de sessão.');
  }
  if (production && (databaseUrl.port !== '6543'
      || !databaseUrl.hostname.endsWith('.pooler.supabase.com'))) {
    throw new Error('Produção exige a URL Supavisor Transaction (*.pooler.supabase.com:6543).');
  }

  // pg pode sobrescrever a opção ssl quando a URL contém sslmode/sslrootcert.
  // Normalizamos tudo aqui para nunca desativar a verificação do certificado.
  const sslMode = databaseUrl.searchParams.get('sslmode');
  const sslDisabled = env.DB_SSL === 'disable' || sslMode === 'disable';
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname);
  if (sslDisabled && (production || !loopback)) {
    throw new Error('TLS só pode ser desativado em PostgreSQL local fora de produção.');
  }
  if (env.DB_SSL && !['disable', 'verify-full'].includes(env.DB_SSL)) {
    throw new Error('DB_SSL deve ser verify-full ou disable (somente testes locais).');
  }
  if (sslMode && !['verify-full', 'verify-ca', 'require', 'disable'].includes(sslMode)) {
    throw new Error('sslmode não permitido; utilize verify-full.');
  }
  const caPath = env.DB_SSL_ROOT_CERT || databaseUrl.searchParams.get('sslrootcert');
  const ssl = sslDisabled ? false : {
    rejectUnauthorized: true,
    ...(caPath ? { ca: readFileSync(caPath, 'utf8') } : {}),
  };
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat', 'pgbouncer']) {
    databaseUrl.searchParams.delete(key);
  }

  const token = env.API_TOKEN;
  if (!token || token.length < 32 || /\s/.test(token)) {
    throw new Error('API_TOKEN deve ser um segredo de pelo menos 32 caracteres sem espaços.');
  }
  const poolMax = integer(env, 'DB_POOL_MAX', 30, 1, 50);
  const statementTimeout = integer(env, 'DB_STATEMENT_TIMEOUT_MS', 5000);
  const queryTimeout = integer(env, 'DB_QUERY_TIMEOUT_MS', 7000);
  if (queryTimeout <= statementTimeout) {
    throw new Error('DB_QUERY_TIMEOUT_MS deve superar DB_STATEMENT_TIMEOUT_MS do papel no banco.');
  }

  return {
    token,
    host: env.HOST || '0.0.0.0',
    port: integer(env, 'PORT', 3000, 1, 65535),
    logLevel: env.LOG_LEVEL || 'warn',
    shutdownTimeout: integer(env, 'SHUTDOWN_TIMEOUT_MS', 30000),
    maxPending: poolMax + integer(env, 'DB_QUEUE_MAX', 2000, 0, 100000),
    pool: {
      connectionString: databaseUrl.toString(),
      ssl,
      max: poolMax,
      connectionTimeoutMillis: integer(env, 'DB_ACQUIRE_TIMEOUT_MS', 5000),
      idleTimeoutMillis: integer(env, 'DB_IDLE_TIMEOUT_MS', 30000),
      query_timeout: queryTimeout,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      application_name: 'ac-prod-mes-api',
      // statement_timeout/lock_timeout são configurados no papel mes_api.
      // SET de sessão não é confiável no pooler transacional.
    },
  };
}
