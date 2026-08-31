function required(env, name) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

function integer(env, name, fallback, min, max) {
  const value = Number.parseInt(env[name] || String(fallback), 10);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} deve estar entre ${min} e ${max}.`);
  }
  return value;
}

function isLoopbackHost(host) {
  return ['127.0.0.1', 'localhost', '::1'].includes(host);
}

export function loadConfig(env = process.env) {
  const host = String(env.EDGE_HOST || '').trim() || '127.0.0.1';
  const ingestToken = String(env.EDGE_INGEST_TOKEN || '').trim() || null;

  if (!isLoopbackHost(host) && !ingestToken) {
    throw new Error(
      'EDGE_INGEST_TOKEN é obrigatório quando EDGE_HOST expõe o worker na rede.',
    );
  }

  return {
    supabaseUrl: required(env, 'SUPABASE_URL'),
    supabasePublishableKey: required(env, 'SUPABASE_PUBLISHABLE_KEY'),
    edgeEmail: required(env, 'SUPABASE_EDGE_EMAIL'),
    edgePassword: required(env, 'SUPABASE_EDGE_PASSWORD'),
    operatorSessionToken: required(env, 'OPERATOR_SESSION_TOKEN'),
    cellName: required(env, 'CELL_NAME'),
    shift: String(env.SHIFT || '').trim() || 'Turno não informado',
    operatorName: String(env.OPERATOR_NAME || '').trim() || 'Coletor Edge',
    operatorId: String(env.OPERATOR_ID || '').trim() || null,
    machineId: String(env.MACHINE_ID || '').trim() || null,
    machineName: String(env.MACHINE_NAME || '').trim() || null,
    deviceId: String(env.DEVICE_ID || '').trim() || 'acprod-edge-worker',
    readerType: String(env.READER_TYPE || '').trim() || 'keyboard_barcode',
    host,
    ingestToken,
    port: integer(env, 'PORT', 8787, 1, 65535),
    flushIntervalMs: integer(env, 'FLUSH_INTERVAL_MS', 5000, 1000, 60000),
    maxBatchSize: integer(env, 'MAX_BATCH_SIZE', 50, 1, 100),
    spoolFile: String(env.EDGE_SPOOL_FILE || '').trim()
      || './data/collection-spool.jsonl',
    simulateCount: integer(env, 'SIMULATE_COUNT', 20, 1, 10000),
    simulateIntervalMs: integer(
      env,
      'SIMULATE_INTERVAL_MS',
      80,
      10,
      60000,
    ),
  };
}
