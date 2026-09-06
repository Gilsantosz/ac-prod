import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.106.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CYCLE_RPC = "run_collection_worker_cycle_v3";
const RELEASE_SLOT_RPC = "release_collection_worker_slot_v3";
const HANDOFF_RPC = "handoff_collection_worker_v3";
const WORKER_KIND = "projection";
const MIN_BATCH_SIZE = 5;
const DEFAULT_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 5;
const DEFAULT_MAX_ROUNDS = 5;
const MAX_ROUNDS = 5;
// Leave time for a final transactional RPC and handoff before pg_net's 30s cap.
const MAX_RUN_DURATION_MS = 12000;

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
  readonly databaseReason: string | null;

  constructor(publicCode: string, databaseCode: string | null = null, databaseReason: string | null = null) {
    super(publicCode);
    this.name = "WorkerFailure";
    this.publicCode = publicCode;
    this.databaseCode = databaseCode;
    this.databaseReason = databaseReason;
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

function safeDatabaseReason(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("message" in error)) return null;
  // Whitelist only fixed reason labels; never expose SQL, payloads or details.
  const reasons: Record<string, string> = {
    "more than one row returned by a subquery used as an expression": "SCALAR_SUBQUERY_MULTIPLE_ROWS",
    "query returned more than one row": "QUERY_MULTIPLE_ROWS",
    "ON CONFLICT DO UPDATE command cannot affect row a second time": "UPSERT_DUPLICATE_TARGET",
    "UPDATE requires a WHERE clause": "SAFEUPDATE_UPDATE_WITHOUT_WHERE",
    "DELETE requires a WHERE clause": "SAFEUPDATE_DELETE_WITHOUT_WHERE",
  };
  const message = String(Reflect.get(error, "message")).toLowerCase();
  return Object.entries(reasons).find(([reason]) => message.includes(reason.toLowerCase()))?.[1] ?? null;
}

function workerCycle(data: unknown): JsonRecord {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new WorkerFailure("INVALID_CYCLE_RESPONSE");
  }
  return data as JsonRecord;
}

function safeCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new WorkerFailure("INVALID_CYCLE_COUNT");
  }
  return parsed;
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

  const secret = req.headers.get("x-cron-secret")?.trim() ?? "";
  if (!secret) {
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
  const requestedLeaseOwner = typeof body.lease_owner === "string"
    && /^[a-zA-Z0-9:_-]{1,160}$/.test(body.lease_owner)
    ? body.lease_owner
    : `edge:${invocationId}`;
  const startedAt = performance.now();

  let rounds = 0;
  let batchesProcessed = 0;
  let totalClaimed = 0;
  let leaseRetained = false;
  let handoffRequired = false;

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      const workerId = `projection-v3:${invocationId}:${round}`;
      const { data, error } = await admin.rpc(CYCLE_RPC, {
        p_worker_kind: WORKER_KIND,
        p_secret: secret,
        p_lease_owner: requestedLeaseOwner,
        p_worker_id: workerId,
        p_limit: limit,
      });
      if (error) {
        leaseRetained = true;
        throw new WorkerFailure("WORKER_CYCLE_FAILED", safeDatabaseCode(error), safeDatabaseReason(error));
      }

      // Em caso de resposta malformada, tente liberar o slot pelo owner. A
      // liberação é idempotente quando a autorização falhou antes do lease.
      leaseRetained = true;
      const cycle = workerCycle(data);
      if (cycle.authorized !== true) {
        return jsonResponse(401, { error: "UNAUTHORIZED_COLLECTION_PROJECTOR" });
      }
      if (cycle.coalesced === true) {
        return jsonResponse(202, {
          ok: true,
          coalesced: true,
          invocation_id: invocationId,
        });
      }

      rounds += 1;
      const claimed = safeCount(cycle.claimed);
      const processed = safeCount(cycle.processed);
      if (processed > claimed) throw new WorkerFailure("INVALID_CYCLE_COUNT");

      leaseRetained = cycle.lease_retained === true;
      totalClaimed += claimed;
      if (claimed === 0) break;
      batchesProcessed += 1;
      if (claimed < limit) break;
      handoffRequired = round === maxRounds - 1;
      if (performance.now() - startedAt >= MAX_RUN_DURATION_MS) {
        handoffRequired = leaseRetained;
        break;
      }
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
      database_reason: failure.databaseReason,
      rounds,
      batches_processed: batchesProcessed,
      claimed: totalClaimed,
      duration_ms: durationMs,
    }));

    return jsonResponse(500, {
      ok: false,
      invocation_id: invocationId,
      error: failure.publicCode,
      // Safe SQLSTATE only: persisted by pg_net even when the database batch
      // rolled back, so a failed claim cannot make health falsely look clean.
      database_code: failure.databaseCode,
      database_reason: failure.databaseReason,
      duration_ms: durationMs,
    });
  } finally {
    if (leaseRetained) {
      const rpcName = handoffRequired ? HANDOFF_RPC : RELEASE_SLOT_RPC;
      const rpcArguments = handoffRequired
        ? {
          p_worker_kind: WORKER_KIND,
          p_lease_owner: requestedLeaseOwner,
          p_limit: limit,
        }
        : {
          p_worker_kind: WORKER_KIND,
          p_lease_owner: requestedLeaseOwner,
        };
      const { error } = await admin.rpc(rpcName, rpcArguments);
      if (error) {
        console.error(JSON.stringify({
          event: handoffRequired
            ? "collection_v3_projection_handoff_failed"
            : "collection_v3_projection_slot_release_failed",
          invocation_id: invocationId,
          database_code: safeDatabaseCode(error),
        }));
      }
    }
  }
});
