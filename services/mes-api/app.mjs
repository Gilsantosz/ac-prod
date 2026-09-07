import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify, { LogController } from 'fastify';
import pg from 'pg';

export const INSERT_SQL = `
  INSERT INTO public.apontamentos_producao
    (id, equipamento_id, produto_id, qte_boa, qte_refugo,
     inicio_operacao, fim_operacao, origem_tempo, teve_interrupcao, retrabalho)
  VALUES ($1::uuid, $2::uuid, $3::uuid, $4::integer, $5::integer,
          $6::timestamptz, $7::timestamptz, $8::text, $9::boolean, $10::boolean)
  ON CONFLICT (id) DO NOTHING
  RETURNING id, equipamento_id, produto_id, qte_boa, qte_refugo, data_hora,
            inicio_operacao, fim_operacao, origem_tempo, teve_interrupcao, retrabalho
`;
export const FIND_SQL = `
  SELECT id, equipamento_id, produto_id, qte_boa, qte_refugo, data_hora,
         inicio_operacao, fim_operacao, origem_tempo, teve_interrupcao, retrabalho,
         ROW(equipamento_id, produto_id, qte_boa, qte_refugo,
             inicio_operacao, fim_operacao, origem_tempo, teve_interrupcao, retrabalho)
           IS NOT DISTINCT FROM
         ROW($2::uuid, $3::uuid, $4::integer, $5::integer,
             $6::timestamptz, $7::timestamptz, $8::text, $9::boolean, $10::boolean)
           AS payload_identico
  FROM public.apontamentos_producao WHERE id = $1::uuid
`;
export const OEE_SQL = 'SELECT * FROM public.oee_tempo_real ORDER BY oee_percentual DESC;';

const hash = (value) => createHash('sha256').update(value).digest();
const measurementFields = ['inicio_operacao', 'fim_operacao', 'origem_tempo', 'teve_interrupcao', 'retrabalho'];
const operationTimestamp = {
  type: 'string', format: 'date-time', maxLength: 32,
  // RFC 3339 com fuso explícito e precisão máxima nativa do PostgreSQL.
  // O formato date-time do AJV também valida calendário, horas e fuso.
  pattern: '^(?!0000)\\d{4}-\\d{2}-\\d{2}[Tt]\\d{2}:\\d{2}:[0-5]\\d(?:\\.\\d{1,6})?(?:[Zz]|[+-]\\d{2}:\\d{2})$',
};

export function databaseError(error) {
  if (error.code === '23503') return [422, 'EQUIPAMENTO_OU_PRODUTO_INEXISTENTE'];
  if (['23514', '22003', '22007', '22008', '22P02'].includes(error.code)) return [400, 'DADOS_INVALIDOS'];
  if (error.code === '55P03') return [503, 'BANCO_OCUPADO'];
  if (error.code === '57014') return [504, 'TEMPO_LIMITE_DA_OPERACAO'];
  if (error.message === 'Query read timeout') return [504, 'RESULTADO_NAO_CONFIRMADO'];
  if (['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EHOSTUNREACH',
    'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN'].includes(error.code)
    || /^(08|28|53|57P)/.test(error.code || '')
    || /connect|connection|terminated/i.test(error.message || '')) {
    return [503, 'BANCO_INDISPONIVEL'];
  }
  return [500, 'ERRO_INTERNO'];
}

export function createApp(config, { pool = new pg.Pool(config.pool), logger } = {}) {
  const app = Fastify({
    logger: logger ?? {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'headers.authorization', 'token', 'DATABASE_URL'],
    },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 8192,
    requestTimeout: 15000,
    keepAliveTimeout: 5000,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false, useDefaults: false } },
  });
  const expectedToken = hash(config.token);
  const pending = new Set();
  let closing = false;
  app.decorate('beginShutdown', () => { closing = true; });

  pool.on('error', (error) => {
    app.log.error({ code: error.code || 'PG_CONNECTION_ERROR' }, 'Falha em conexão ociosa.');
  });

  // Liveness não consulta dados e não expõe credenciais ou detalhes do banco.
  app.get('/healthz', async (_request, reply) => {
    return reply.code(closing ? 503 : 200).send({ status: closing ? 'closing' : 'ok' });
  });

  async function authenticate(request, reply) {
    const header = request.headers.authorization;
    const supplied = typeof header === 'string' && header.startsWith('Bearer ')
      ? header.slice(7) : '';
    if (!supplied || supplied.length > 4096 || !timingSafeEqual(hash(supplied), expectedToken)) {
      return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ erro: 'NAO_AUTORIZADO' });
    }
  }

  // A reserva é síncrona, antes do primeiro await. GET e POST compartilham
  // orçamento: o pg enfileira somente um número limitado de operações.
  async function withDatabase(request, reply, operation) {
    if (closing || pending.size >= config.maxPending) {
      return reply.code(503).header('Retry-After', '1')
        .send({ erro: 'CAPACIDADE_TEMPORARIAMENTE_ESGOTADA' });
    }
    if (reply.raw.destroyed) return;
    const work = Promise.resolve().then(operation);
    pending.add(work);
    try {
      const { status, body, replay = false } = await work;
      if (!reply.raw.destroyed) {
        if (replay) reply.header('Idempotency-Replayed', 'true');
        return reply.code(status).send(body);
      }
    } catch (error) {
      const [status, code] = databaseError(error);
      if (status >= 500) request.log.error({ code: error.code || code }, 'Falha na operação MES.');
      if (!reply.raw.destroyed) return reply.code(status).send({ erro: code });
    } finally {
      pending.delete(work);
    }
  }

  app.post('/api/apontamentos', {
    onRequest: authenticate,
    schema: {
      headers: {
        type: 'object',
        required: ['idempotency-key'],
        properties: { 'idempotency-key': { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['equipamento_id', 'produto_id', 'qte_boa', 'qte_refugo'],
        // Medição ausente preserva o contrato original; parcialmente enviada
        // é recusada, sem inventar horários, procedência ou indicadores.
        dependencies: Object.fromEntries(measurementFields.map((field) => [field, measurementFields])),
        properties: {
          equipamento_id: { type: 'string', format: 'uuid' },
          produto_id: { type: 'string', format: 'uuid' },
          qte_boa: { type: 'integer', minimum: 0, maximum: 2147483647 },
          qte_refugo: { type: 'integer', minimum: 0, maximum: 2147483647 },
          inicio_operacao: operationTimestamp,
          fim_operacao: operationTimestamp,
          origem_tempo: { type: 'string', enum: ['sensor', 'operador'] },
          teve_interrupcao: { type: 'boolean' },
          retrabalho: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => withDatabase(request, reply, async () => {
    const id = request.headers['idempotency-key'].toLowerCase();
    const { equipamento_id, produto_id, qte_boa, qte_refugo } = request.body;
    const values = [id, equipamento_id.toLowerCase(), produto_id.toLowerCase(), qte_boa, qte_refugo,
      ...measurementFields.map((field) => request.body[field] ?? null)];
    // Sem prepared statement nomeado: compatível com Supavisor Transaction.
    const inserted = await pool.query(INSERT_SQL, values);
    if (inserted.rows.length) return { status: 201, body: inserted.rows[0] };

    // Outra instrução obtém snapshot novo após eventual INSERT concorrente.
    // Não há UPDATE fictício, que exigiria privilégio e criaria versões extras.
    // O banco compara instantes normalizados, sem truncar microssegundos em
    // Date do JavaScript. Representações equivalentes de fuso são idênticas.
    const { rows } = await pool.query(FIND_SQL, values);
    const previous = rows[0];
    if (!previous) return { status: 503, body: { erro: 'RESULTADO_NAO_CONFIRMADO' } };
    const { payload_identico, ...stored } = previous;
    return payload_identico
      ? { status: 200, body: stored, replay: true }
      : { status: 409, body: { erro: 'CHAVE_REUTILIZADA_COM_DADOS_DIFERENTES' } };
  }));

  app.get('/api/oee', { onRequest: authenticate }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return withDatabase(request, reply, async () => {
      const { rows } = await pool.query(OEE_SQL);
      return { status: 200, body: rows };
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const status = error.validation ? 400
      : (error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500);
    if (status === 500) request.log.error({ code: error.code || 'HTTP_ERROR' }, 'Falha HTTP.');
    return reply.code(status).send({
      erro: error.validation ? 'PAYLOAD_OU_CHAVE_INVALIDOS'
        : (status < 500 ? 'REQUISICAO_INVALIDA' : 'ERRO_INTERNO'),
    });
  });

  app.addHook('preClose', async () => { closing = true; });
  app.addHook('onClose', async () => {
    // Abrange gravações aceitas cujo cliente HTTP já desconectou.
    await Promise.allSettled([...pending]);
    await pool.end();
  });
  return app;
}
