import { createApp } from './app.mjs';
import { loadConfig } from './config.mjs';

let app;
let stopping = false;
let config;

async function shutdown() {
  if (stopping) return;
  stopping = true;
  app?.beginShutdown();
  const deadline = setTimeout(() => process.exit(1), config?.shutdownTimeout || 30000);
  deadline.unref();
  try { await app?.close(); }
  catch { process.exitCode = 1; }
  finally { clearTimeout(deadline); }
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

try {
  config = loadConfig();
  app = createApp(config);
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  // Erros do driver podem conter informações do servidor: nunca imprimir URLs.
  console.error('Não foi possível iniciar a API MES. Verifique a configuração.',
    error?.code || (config ? 'STARTUP_ERROR' : 'CONFIG_INVALID'));
  process.exitCode = 1;
  await shutdown();
}
