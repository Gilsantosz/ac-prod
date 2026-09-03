import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.106.2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CLAIM_WITH_LEASE_RPC = "claim_collection_worker_batch_v3";
const PROCESS_RPC = "process_collection_projection_batch_v3";
const BEGIN_LEASE_RPC = "begin_collection_worker_lease_v3";
const RELEASE_LEASE_RPC = "release_collection_worker_lease_v3";
const LEASE_TTL_SECONDS = 120;
const MAX_REQUEST_BODY_BYTES = 16_384;
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
  const startedAt = performance.now();
  const handlerReceivedAt = Date.now();
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
  }
  const contentLength = Number.parseInt(req.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    return jsonResponse(413, { error: "REQUEST_BODY_TOO_LARGE" });
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
  const wakeEnqueuedAt = typeof body.wake_enqueued_at === "string"
    ? Date.parse(body.wake_enqueued_at)
    : Number.NaN;
  const dispatchDelayMs = Number.isFinite(wakeEnqueuedAt)
    ? Math.max(0, handlerReceivedAt - wakeEnqueuedAt)
    : null;
  const stageMs = {
    begin_lease: 0,
    claim_with_lease: 0,
    process: 0,
  };

  let rounds = 0;
  let batchesProcessed = 0;
  let totalClaimed = 0;
  let leaseAcquired = false;

  try {
    const secret = req.headers.get("x-cron-secret")?.trim() ?? "";
    if (!secret) {
      return jsonResponse(401, { error: "UNAUTHORIZED_COLLECTION_PROJECTOR" });
    }
    const beginLeaseStartedAt = performance.now();
    const { data: leaseStatus, error: leaseError } = await admin.rpc(
      BEGIN_LEASE_RPC,
      {
        p_secret: secret,
        p_worker_kind: "projection",
        p_lease_owner: requestedLeaseOwner,
        p_ttl_seconds: LEASE_TTL_SECONDS,
      },
    );
    stageMs.begin_lease += performance.now() - beginLeaseStartedAt;
    if (leaseError) throw new WorkerFailure("LEASE_BEGIN_FAILED", safeDatabaseCode(leaseError));
    if (leaseStatus === "unauthorized") {
      return jsonResponse(401, { error: "UNAUTHORIZED_COLLECTION_PROJECTOR" });
    }
    if (leaseStatus === "coalesced") {
      return jsonResponse(202, {
        ok: true,
        coalesced: true,
        invocation_id: invocationId,
        dispatch_delay_ms: dispatchDelayMs,
      });
    }
    if (leaseStatus !== "acquired") throw new WorkerFailure("INVALID_LEASE_BEGIN_RESPONSE");
    leaseAcquired = true;

    for (let round = 0; round < maxRounds; round += 1) {
      const workerId = `projection-v3:${invocationId}:${round}`;
      // Renew + claim is atomic and fails closed if this invocation no longer
      // owns an unexpired projector lease.
      const claimWithLeaseStartedAt = performance.now();
      const { data: claimData, error: claimError } = await admin.rpc(
        CLAIM_WITH_LEASE_RPC,
        {
          p_worker_kind: "projection",
          p_lease_owner: requestedLeaseOwner,
          p_worker_id: workerId,
          p_limit: limit,
        },
      );
      stageMs.claim_with_lease += performance.now() - claimWithLeaseStartedAt;
      if (claimError) {
        throw new WorkerFailure("LEASE_OR_CLAIM_FAILED", safeDatabaseCode(claimError));
      }

      rounds += 1;
      const items = claimedItems(claimData);
      if (items.length === 0) break;
      totalClaimed += items.length;

      const processStartedAt = performance.now();
      const { error: processError } = await admin.rpc(
        PROCESS_RPC,
        {
          p_worker_id: workerId,
          p_items: items,
        },
      );
      stageMs.process += performance.now() - processStartedAt;
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
      dispatch_delay_ms: dispatchDelayMs,
      stage_ms: Object.fromEntries(
        Object.entries(stageMs).map(([key, value]) => [key, Number(value.toFixed(3))]),
      ),
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
      dispatch_delay_ms: dispatchDelayMs,
      stage_ms: Object.fromEntries(
        Object.entries(stageMs).map(([key, value]) => [key, Number(value.toFixed(3))]),
      ),
      duration_ms: durationMs,
    }));

    return jsonResponse(500, {
      ok: false,
      invocation_id: invocationId,
      error: failure.publicCode,
    });
  } finally {
    if (leaseAcquired) {
      const { error: releaseError } = await admin.rpc(RELEASE_LEASE_RPC, {
        p_worker_kind: "projection",
        p_lease_owner: requestedLeaseOwner,
      });
      if (releaseError) {
        console.error(JSON.stringify({
          event: "collection_v3_projection_lease_release_failed",
          invocation_id: invocationId,
          database_code: safeDatabaseCode(releaseError),
        }));
      }
    }
  }
});
