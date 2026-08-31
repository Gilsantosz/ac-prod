import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Supabase worker environment is incomplete.");
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

type InboxClaim = {
  coleta_id: string;
  client_event_id: string;
  auth_user_id: string;
  tag_lida: string;
  attempt_count: number;
};

type WorkerResult = {
  processed?: boolean;
  status?: string;
  reason?: string;
  reason_code?: string;
  client_event_id?: string;
};

function jsonResponse(status: number, body: unknown): Response {
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

async function authorizeInternalWakeup(req: Request): Promise<boolean> {
  const secret = req.headers.get("x-cron-secret")?.trim() ?? "";
  if (!secret) return false;

  const { data, error } = await admin.rpc(
    "verify_collection_worker_cron_secret",
    { p_secret: secret },
  );
  return !error && data === true;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        try {
          const value = await task(items[index], index);
          results[index] = { status: "fulfilled", value };
        } catch (reason) {
          results[index] = { status: "rejected", reason };
        }
      }
    },
  );

  await Promise.all(workers);
  return results;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
  }
  if (!(await authorizeInternalWakeup(req))) {
    return jsonResponse(401, { error: "UNAUTHORIZED_COLLECTION_WORKER" });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const limitPerRound = clampInteger(body.limit, 40, 1, 100);
  const concurrency = clampInteger(body.concurrency, 4, 1, 8);
  const maxRounds = clampInteger(body.max_rounds, 4, 1, 6);
  const invocationId = crypto.randomUUID();
  const startedAt = performance.now();

  let claimed = 0;
  let finalized = 0;
  let retriesScheduled = 0;
  let alreadyFinal = 0;
  let failedCalls = 0;
  const failures: Array<{ client_event_id?: string; message: string }> = [];

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      const workerId = `${invocationId}:${round}`;
      const { data: claimData, error: claimError } = await admin.rpc(
        "claim_collection_inbox",
        {
          p_worker_id: workerId,
          p_limit: limitPerRound,
        },
      );

      if (claimError) {
        throw new Error(`CLAIM_FAILED: ${claimError.message}`);
      }

      const claims = (claimData ?? []) as InboxClaim[];
      if (claims.length === 0) break;
      claimed += claims.length;

      const settled = await mapWithConcurrency(
        claims,
        concurrency,
        async (claim): Promise<WorkerResult> => {
          const { data, error } = await admin.rpc(
            "process_collection_inbox_item",
            {
              p_coleta_id: claim.coleta_id,
              p_worker_id: workerId,
            },
          );
          if (error) throw new Error(error.message);
          return (data ?? {}) as WorkerResult;
        },
      );

      settled.forEach((entry, index) => {
        const claim = claims[index];
        if (entry.status === "rejected") {
          failedCalls += 1;
          failures.push({
            client_event_id: claim?.client_event_id,
            message: entry.reason instanceof Error
              ? entry.reason.message
              : String(entry.reason),
          });
          return;
        }

        const result = entry.value;
        if (result.status === "retry_scheduled") retriesScheduled += 1;
        else if (result.reason === "already_final") alreadyFinal += 1;
        else if (result.processed === true) finalized += 1;
      });

      if (claims.length < limitPerRound) break;
    }

    const durationMs = Number((performance.now() - startedAt).toFixed(3));
    console.log(JSON.stringify({
      event: "collection_inbox_worker_completed",
      invocation_id: invocationId,
      source: "internal-secret",
      claimed,
      finalized,
      retries_scheduled: retriesScheduled,
      already_final: alreadyFinal,
      failed_calls: failedCalls,
      duration_ms: durationMs,
    }));

    return jsonResponse(200, {
      ok: failedCalls === 0,
      invocation_id: invocationId,
      source: "internal-secret",
      claimed,
      finalized,
      retries_scheduled: retriesScheduled,
      already_final: alreadyFinal,
      failed_calls: failedCalls,
      failures: failures.slice(0, 20),
      duration_ms: durationMs,
    });
  } catch (error) {
    const durationMs = Number((performance.now() - startedAt).toFixed(3));
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      event: "collection_inbox_worker_failed",
      invocation_id: invocationId,
      source: "internal-secret",
      claimed,
      duration_ms: durationMs,
      error: message,
    }));
    return jsonResponse(500, {
      ok: false,
      invocation_id: invocationId,
      error: message,
      claimed,
      duration_ms: durationMs,
    });
  }
});
