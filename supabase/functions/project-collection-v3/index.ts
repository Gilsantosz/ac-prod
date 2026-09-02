import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.106.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CLAIM_RPC = "claim_collection_projection_batch_v3";
const PROCESS_RPC = "process_collection_projection_batch_v3";
const MIN_BATCH_SIZE = 5;
const DEFAULT_BATCH_SIZE = 10;
const MAX_BATCH_SIZE = 25;
const DEFAULT_MAX_ROUNDS = 3;
const MAX_ROUNDS = 5;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("COLLECTION_V3_PROJECTOR_ENVIRONMENT_INCOMPLETE");
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const responseHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-cron-secret",
  "access-control-allow-methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, unknown>;

class WorkerFailure extends Error {
  readonly publicCode: string;
  readonly databaseCode: string | null;

  constructor(publicCode: string, databaseCode: string | null = null) {
    super(publicCode);
    this.name = "WorkerFailure";
    this.publicCode = publicCode;
    this.databaseCode = databaseCode;
  }
}

function jsonResponse(status: number, body: JsonRecord): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...responseHeaders,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function safeDatabaseCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = String(error.code ?? "").trim().toUpperCase();
  return /^[A-Z0-9_]{1,32}$/.test(code) ? code : null;
}

function claimedItems(data: unknown): unknown[] {
  if (data === null || data === undefined) return [];
  if (!Array.isArray(data)) {
    throw new WorkerFailure("INVALID_CLAIM_RESPONSE");
  }
  return data;
}

async function authorizeInternalWakeup(req: Request): Promise<boolean> {
  const secret = req.headers.get("x-cron-secret")?.trim() ?? "";
  if (!secret) return false;

  const { data, error } = await admin.rpc(
    "verify_collection_worker_cron_secret",
    { p_secret: secret },
  );
  return !error && data === true;
}

async function requestBody(req: Request): Promise<JsonRecord> {
  try {
    const value: unknown = await req.json();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as JsonRecord;
    }
  } catch {
    // Corpo ausente usa limites seguros.
  }
  return {};
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
  }
  if (!(await authorizeInternalWakeup(req))) {
    return jsonResponse(401, { error: "UNAUTHORIZED_COLLECTION_PROJECTOR" });
  }

  const body = await requestBody(req);
  const limit = clampInteger(
    body.limit,
    DEFAULT_BATCH_SIZE,
    MIN_BATCH_SIZE,
    MAX_BATCH_SIZE,
  );
  const maxRounds = clampInteger(
    body.max_rounds,
    DEFAULT_MAX_ROUNDS,
    1,
    MAX_ROUNDS,
  );
  const invocationId = crypto.randomUUID();
  const startedAt = performance.now();

  let rounds = 0;
  let batchesProcessed = 0;
  let totalClaimed = 0;

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      const workerId = `projection-v3:${invocationId}:${round}`;
      const { data: claimData, error: claimError } = await admin.rpc(
        CLAIM_RPC,
        {
          p_worker_id: workerId,
          p_limit: limit,
        },
      );
      if (claimError) {
        throw new WorkerFailure("CLAIM_FAILED", safeDatabaseCode(claimError));
      }

      rounds += 1;
      const items = claimedItems(claimData);
      if (items.length === 0) break;
      totalClaimed += items.length;

      const { error: processError } = await admin.rpc(
        PROCESS_RPC,
        {
          p_worker_id: workerId,
          p_items: items,
        },
      );
      if (processError) {
        throw new WorkerFailure(
          "PROCESS_BATCH_FAILED",
          safeDatabaseCode(processError),
        );
      }

      batchesProcessed += 1;
      if (items.length < limit) break;
    }

    const durationMs = Number((performance.now() - startedAt).toFixed(3));
    const summary = {
      event: "collection_v3_projection_worker_completed",
      invocation_id: invocationId,
      rounds,
      batches_processed: batchesProcessed,
      claimed: totalClaimed,
      batch_limit: limit,
      duration_ms: durationMs,
    };
    console.log(JSON.stringify(summary));

    return jsonResponse(200, { ok: true, ...summary });
  } catch (error) {
    const failure = error instanceof WorkerFailure
      ? error
      : new WorkerFailure("WORKER_FAILED");
    const durationMs = Number((performance.now() - startedAt).toFixed(3));

    console.error(JSON.stringify({
      event: "collection_v3_projection_worker_failed",
      invocation_id: invocationId,
      error_code: failure.publicCode,
      database_code: failure.databaseCode,
      rounds,
      batches_processed: batchesProcessed,
      claimed: totalClaimed,
      duration_ms: durationMs,
    }));

    return jsonResponse(500, {
      ok: false,
      invocation_id: invocationId,
      error: failure.publicCode,
    });
  }
});
