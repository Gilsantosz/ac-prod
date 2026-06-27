// Edge Function: generate-productive-backup
// Gera backup completo da Ordem de Produção com retenção de 4 anos.
// SEGURANÇA: Usa service role somente no servidor, nunca exposto ao frontend.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let supabaseClient: any = null;
  let batchIdParam: string | null = null;
  let requestedByParam: string | null = null;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );
    supabaseClient = supabase;

    const { orderId, lotId, batchId, xmlContent, parsedData, requestedBy, type } =
      await req.json();

    if (type === 'full_snapshot') {
      const now = new Date();
      const year  = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const basePath = `full_snapshots/${year}/${month}`;
      
      const [
        ordersResult,
        lotsResult,
        legacyItemsResult,
        orderItemsResult,
        lotItemsResult,
        routesResult,
        tagsResult,
        readingsResult,
        entriesResult,
        occurrencesResult,
        eventsResult,
      ] = await Promise.all([
        supabase.from("production_orders").select("*"),
        supabase.from("production_lots").select("*"),
        supabase.from("lot_items").select("*"),
        supabase.from("production_order_items").select("*"),
        supabase.from("production_lot_items").select("*"),
        supabase.from("production_routes").select("*"),
        supabase.from("production_tags").select("*"),
        supabase.from("production_stage_readings").select("*"),
        supabase.from("production_entries").select("*"),
        supabase.from("occurrences").select("*"),
        supabase.from("lot_step_events").select("*"),
      ]);
      
      const fullSnapshot = JSON.stringify({
        orders: ordersResult.data || [],
        lots: lotsResult.data || [],
        legacyItems: legacyItemsResult.data || [],
        orderItems: orderItemsResult.data || [],
        lotItems: lotItemsResult.data || [],
        routes: routesResult.data || [],
        tags: tagsResult.data || [],
        readings: readingsResult.data || [],
        entries: entriesResult.data || [],
        occurrences: occurrencesResult.data || [],
        events: eventsResult.data || [],
        snapshotAt: now.toISOString(),
      });
      
      const fileName = `full-snapshot-${now.getTime()}.json`;
      const snapBytes = new TextEncoder().encode(fullSnapshot);
      const snapPath = `${basePath}/${fileName}`;
      
      await supabase.storage
        .from("productive-backups")
        .upload(snapPath, snapBytes, { contentType: "application/json", upsert: true });

      const { data: manifestFile } = await supabase.from("backup_files").insert({
        file_name:       fileName,
        file_type:       "json",
        storage_path:    snapPath,
        file_size:       snapBytes.length,
        revision:        1,
        generated_by:    requestedBy || null,
        expires_at:      addYears(now, 4).toISOString(),
        status:          "available",
      }).select().single();

      return new Response(JSON.stringify({ success: true, data: manifestFile }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (!orderId) throw new Error("orderId é obrigatório");
    batchIdParam = batchId || null;
    requestedByParam = requestedBy || null;

    // ─── Busca dados completos da OP ─────────────────────────
    const { data: order } = await supabase
      .from("production_orders")
      .select("*")
      .eq("id", orderId)
      .single();

    const { data: lots } = await supabase
      .from("production_lots")
      .select("*")
      .or(`order_id.eq.${orderId},production_order_id.eq.${orderId}`);

    const lotIds = lots?.map(l => l.id) || [];

    const { data: legacyItems } = lotId
      ? await supabase.from("lot_items").select("*").eq("lot_id", lotId)
      : lotIds.length
        ? await supabase.from("lot_items").select("*").in("lot_id", lotIds)
        : { data: [] };

    const { data: orderItems } = await supabase
      .from("production_order_items")
      .select("*")
      .eq("production_order_id", orderId);

    const { data: lotItems } = lotId
      ? await supabase.from("production_lot_items").select("*").eq("lot_id", lotId)
      : lotIds.length
        ? await supabase.from("production_lot_items").select("*").in("lot_id", lotIds)
        : { data: [] };

    const { data: routes } = lotId
      ? await supabase.from("production_routes").select("*").eq("lot_id", lotId).order("step_order")
      : lotIds.length
        ? await supabase.from("production_routes").select("*").in("lot_id", lotIds).order("step_order")
        : { data: [] };

    const { data: readings } = await supabase
      .from("production_stage_readings")
      .select("*")
      .eq("production_order_id", orderId)
      .order("created_at", { ascending: true });

    const { data: entries } = await supabase
      .from("production_entries")
      .select("*")
      .eq("production_order_id", orderId)
      .order("created_at", { ascending: true });

    const { data: events } = lotId
      ? await supabase.from("lot_step_events").select("*").eq("lot_id", lotId)
             .order("created_at", { ascending: true })
      : { data: [] };

    // ─── Paths de armazenamento ───────────────────────────────
    const now = new Date();
    const year  = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const code  = order?.order_code || orderId;

    // Determina revisão (número de backups existentes + 1)
    const { count } = await supabase
      .from("backup_files")
      .select("id", { count: "exact", head: true })
      .eq("order_id", orderId);

    const revision = (count || 0) + 1;
    const basePath = `${year}/${month}/${code}/v${revision}`;

    const filesToCreate = [];

    // ─── 1. XML Original ─────────────────────────────────────
    if (xmlContent) {
      const path = `${basePath}/promob-original.xml`;
      const { error } = await supabase.storage
        .from("productive-backups")
        .upload(path, xmlContent, { contentType: "application/xml", upsert: true });

      if (!error) {
        filesToCreate.push({
          order_id:          orderId,
          lot_id:            lotId || null,
          import_batch_id:   batchId || null,
          file_name:         "promob-original.xml",
          file_type:         "xml",
          storage_path:      path,
          file_size:         xmlContent.length,
          revision,
          generated_by:      requestedBy || null,
          expires_at:        addYears(now, 4).toISOString(),
          status:            "available",
        });
      }
    }

    // ─── 2. JSON Normalizado da OP ───────────────────────────
    const normalizedJson = JSON.stringify({
      order,
      lots,
      legacyItems,
      orderItems,
      lotItems,
      routes,
      readings,
      entries,
      parsedData,
      generatedAt: now.toISOString(),
    }, null, 2);

    const jsonPath = `${basePath}/ordem-normalizada.json`;
    const jsonBytes = new TextEncoder().encode(normalizedJson);
    const { error: jsonError } = await supabase.storage
      .from("productive-backups")
      .upload(jsonPath, jsonBytes, { contentType: "application/json", upsert: true });

    if (!jsonError) {
      filesToCreate.push({
        order_id:        orderId,
        lot_id:          lotId || null,
        import_batch_id: batchId || null,
        file_name:       "ordem-normalizada.json",
        file_type:       "json",
        storage_path:    jsonPath,
        file_size:       jsonBytes.length,
        revision,
        generated_by:    requestedBy || null,
        expires_at:      addYears(now, 4).toISOString(),
        status:          "available",
      });
    }

    // ─── 3. Snapshot de rastreabilidade ──────────────────────
    const traceSnapshot = JSON.stringify({
      order,
      lots,
      legacyItems,
      orderItems,
      lotItems,
      routes,
      readings,
      entries,
      events,
      snapshotAt: now.toISOString(),
    }, null, 2);

    const snapPath = `${basePath}/rastreabilidade-snapshot.json`;
    const snapBytes = new TextEncoder().encode(traceSnapshot);
    await supabase.storage
      .from("productive-backups")
      .upload(snapPath, snapBytes, { contentType: "application/json", upsert: true });

    filesToCreate.push({
      order_id:        orderId,
      lot_id:          lotId || null,
      import_batch_id: batchId || null,
      file_name:       "rastreabilidade-snapshot.json",
      file_type:       "json",
      storage_path:    snapPath,
      file_size:       snapBytes.length,
      revision,
      generated_by:    requestedBy || null,
      expires_at:      addYears(now, 4).toISOString(),
      status:          "available",
    });

    // ─── 4. Manifest do backup ────────────────────────────────
    const manifest = {
      orderId,
      lotId,
      orderCode:   order?.order_code,
      customer:    order?.customer_name,
      revision,
      generatedAt: now.toISOString(),
      files:       filesToCreate.map(f => ({ name: f.file_name, type: f.file_type, path: f.storage_path })),
      summary: {
        totalLots:  lots?.length || 0,
        totalItems: (orderItems?.length || 0) + (lotItems?.length || 0) + (legacyItems?.length || 0),
        totalEvents: (readings?.length || 0) + (events?.length || 0),
      },
    };

    const manifestPath = `${basePath}/backup-manifest.json`;
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
    await supabase.storage
      .from("productive-backups")
      .upload(manifestPath, manifestBytes, { contentType: "application/json", upsert: true });

    // ─── Registrar todos os arquivos no banco ─────────────────
    if (filesToCreate.length > 0) {
      await supabase.from("backup_files").insert(filesToCreate);
    }

    // Registrar manifest separado
    const { data: manifestFile } = await supabase.from("backup_files").insert({
      order_id:        orderId,
      lot_id:          lotId || null,
      import_batch_id: batchId || null,
      file_name:       "backup-manifest.json",
      file_type:       "json",
      storage_path:    manifestPath,
      file_size:       manifestBytes.length,
      revision,
      generated_by:    requestedBy || null,
      expires_at:      addYears(now, 4).toISOString(),
      status:          "available",
    }).select().single();

    // ─── Atualizar status do backup no lote de importação ─────
    if (batchId) {
      await supabase
        .from("promob_import_batches")
        .update({ backup_status: "realizado" })
        .eq("id", batchId);

      await supabase.from("pcp_import_logs").insert({
        import_file_id: batchId,
        user_id: requestedBy || null,
        action: "backup_created",
        message: `Backup automático de 4 anos criado com sucesso (${filesToCreate.length + 1} arquivos)`,
        severity: "info",
        metadata_json: { basePath, files: filesToCreate.map(f => f.file_name) }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      data: {
        orderId,
        revision,
        basePath,
        filesCreated: filesToCreate.length + 1,  // +1 manifest
        expiresAt:    addYears(now, 4).toISOString(),
      },
    }), { headers: { ...CORS, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[generate-productive-backup]", err);

    if (supabaseClient && batchIdParam) {
      await supabaseClient
        .from("promob_import_batches")
        .update({ backup_status: "falhou" })
        .eq("id", batchIdParam);

      await supabaseClient.from("pcp_import_logs").insert({
        import_file_id: batchIdParam,
        user_id: requestedByParam || null,
        action: "backup_failed",
        message: `Falha na geração do backup automático: ${err.message}`,
        severity: "error"
      });
    }

    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}
