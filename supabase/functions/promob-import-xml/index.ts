// Edge Function: promob-import-xml
// Processa upload de XML do Promob, grava no banco e dispara backup automático.
// SEGURANÇA: Toda operação de escrita passa por esta Edge Function (service role no servidor)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function isMissingSchemaError(error: any) {
  return Boolean(error && (
    ["PGRST202", "PGRST204", "PGRST205", "42P01", "42703"].includes(error.code)
    || /schema cache|could not find|does not exist/i.test(error.message || "")
  ));
}

function normalizeTagValue(value: unknown) {
  return String(value ?? "").replace(/[\r\n\t\s]/g, "").trim().toUpperCase();
}

function tagKind(value: string, preferredType = "barcode") {
  const upper = normalizeTagValue(value);
  if (preferredType === "qrcode") return { tagType: "qrcode", tagFormat: "qrcode" };
  if (/^\]D2/.test(upper) || /^(01|10|21)\d{8,}/.test(upper)) return { tagType: "datamatrix", tagFormat: "datamatrix" };
  if (/^[A-F0-9]{24}$/.test(upper) || /^EPC[-:_]/.test(upper)) return { tagType: "rfid_epc", tagFormat: /^[A-F0-9]{24}$/.test(upper) ? "epc96" : "custom" };
  if (/^https?:\/\//i.test(String(value)) || /^[{[]/.test(String(value).trim()) || /^QR[:_-]/i.test(String(value))) return { tagType: "qrcode", tagFormat: "qrcode" };
  if (/^\d{13}$/.test(upper)) return { tagType: "barcode", tagFormat: "ean13" };
  return { tagType: "barcode", tagFormat: "custom" };
}

function routePayloadForImport(lotId: string, allItems: any[]) {
  const has = (key: string) => allItems.some((item) => item[key] !== false);
  return [
    { step_order: 1, step_name: "Corte", required: true },
    { step_order: 2, step_name: "Bordo", required: allItems.some((item) => item.requiresEdge) },
    { step_order: 3, step_name: "Usinagem", required: allItems.some((item) => item.requiresCnc) },
    { step_order: 4, step_name: "Marcenaria", required: allItems.some((item) => item.requiresJoinery) },
    { step_order: 5, step_name: "Separação", required: has("requiresSeparation") },
    { step_order: 6, step_name: "Embalagem", required: has("requiresPackaging") },
    { step_order: 7, step_name: "Expedição", required: has("requiresShipping") },
  ]
    .filter((step) => step.required)
    .map((step) => ({ lot_id: lotId, ...step, cell_name: null }));
}

async function createCollectionArtifacts(supabase: any, lot: any, lotItems: any[], parsedItems: any[]) {
  if (!lot?.id || !lotItems.length) return;

  const routesPayload = routePayloadForImport(lot.id, parsedItems);
  const { error: routesError } = await supabase
    .from("production_routes")
    .upsert(routesPayload, { onConflict: "lot_id,step_order" });
  if (routesError) {
    if (isMissingSchemaError(routesError)) return;
    throw routesError;
  }

  const firstStep = routesPayload[0]?.step_name || "Corte";
  const parsedByCode = new Map(parsedItems.map((item) => [String(item.code || "").trim(), item]));
  const productionItemsPayload = lotItems.map((lotItem) => ({
    lot_id: lot.id,
    source_lot_item_id: lotItem.id,
    item_code: String(lotItem.piece_code || lotItem.id).trim(),
    product_code: lotItem.piece_code,
    product_name: lotItem.piece_name || "Peca sem descricao",
    current_step: firstStep,
    current_cell: null,
    status: ["completed", "blocked", "rework", "scrap", "cancelled"].includes(lotItem.status) ? lotItem.status : "pending",
    created_at: lotItem.created_at,
    updated_at: lotItem.updated_at,
    lot_code: lot.lot_code,
    load_number: lotItem.load_number,
    order_number: lotItem.order_number,
    customer_name: lotItem.customer_name,
    environment_name: lotItem.environment_name,
    sheet_count: lotItem.sheet_count,
    edge_meters: lotItem.edge_meters,
    pieces_quantity: lotItem.pieces_quantity,
    covers_quantity: lotItem.covers_quantity,
  }));

  const { data: productionItems, error: productionItemsError } = await supabase
    .from("production_lot_items")
    .upsert(productionItemsPayload, { onConflict: "lot_id,item_code" })
    .select("id,lot_id,item_code,source_lot_item_id");
  if (productionItemsError) {
    if (isMissingSchemaError(productionItemsError)) return;
    throw productionItemsError;
  }

  const itemBySource = new Map((productionItems || []).map((item: any) => [item.source_lot_item_id, item]));
  const tagsPayload: any[] = [];
  const seenTags = new Set<string>();

  lotItems.forEach((lotItem) => {
    const productionItem = itemBySource.get(lotItem.id);
    if (!productionItem) return;

    const parsedItem = parsedByCode.get(String(lotItem.piece_code || "").trim()) || {};
    const explicitTags = [
      { value: parsedItem.barcode, preferredType: "barcode" },
      { value: parsedItem.qrCode, preferredType: "qrcode" },
    ].filter((tag) => normalizeTagValue(tag.value));
    const candidates = explicitTags.length
      ? explicitTags
      : [{ value: lotItem.piece_code, preferredType: "barcode" }];

    for (const candidate of candidates) {
      const tagValue = normalizeTagValue(candidate.value);
      if (!tagValue || seenTags.has(tagValue)) continue;
      seenTags.add(tagValue);
      const kind = tagKind(tagValue, candidate.preferredType);
      tagsPayload.push({
        lot_id: lot.id,
        item_id: productionItem.id,
        tag_value: tagValue,
        tag_type: kind.tagType,
        tag_format: kind.tagFormat,
        barcode_value: kind.tagType === "barcode" ? tagValue : null,
        qr_value: kind.tagType === "qrcode" ? tagValue : null,
        epc_code: kind.tagType === "rfid_epc" ? tagValue : null,
        active: true,
      });
    }
  });

  if (!tagsPayload.length) return;
  const { error: tagsError } = await supabase
    .from("production_tags")
    .upsert(tagsPayload, { onConflict: "tag_value", ignoreDuplicates: true });
  if (tagsError) {
    if (isMissingSchemaError(tagsError)) return;
    throw tagsError;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let importBatchId: string | null = null;
  let supabaseClient: any = null;
  let userId: string | null = null;

  try {
    // ─── Auth ─────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Autenticação necessária");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );
    supabaseClient = supabase;

    // Verifica token do usuário
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Token inválido");
    userId = user.id;

    // Verifica permissão (apenas admin e manager)
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!["admin", "manager"].includes(profile?.role)) {
      throw new Error("Permissão insuficiente para importar arquivos no Portal PCP");
    }

    // ─── Recebe payload ───────────────────────────────────────
    const body = await req.json();
    const { 
      xmlContent: legacyXmlContent, 
      fileContent, 
      fileType = "xml", 
      fileName, 
      integrationId, 
      parsedData,
      totalErrors = 0,
      totalWarnings = 0
    } = body;
    const xmlContent = fileContent || legacyXmlContent;

    if (!xmlContent) throw new Error("fileContent ou xmlContent é obrigatório");

    // ─── Parse do XML/Planilha ─────────────────────────────────────────
    let parsed = parsedData;
    if (!parsed) {
      // Chama a Edge Function promob-parse-order internamente
      const parseResp = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/promob-parse-order`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ fileContent: xmlContent, fileType, fileName }),
        }
      );
      const parseResult = await parseResp.json();
      if (!parseResult.success) throw new Error(`Falha no parse: ${parseResult.error}`);
      parsed = parseResult.data;
    }

    const { project, allItems, summary } = parsed;

    // Calcular tamanho em bytes
    const encoder = new TextEncoder();
    const fileSize = fileType === "xlsx" 
      ? base64ToUint8Array(xmlContent).length 
      : encoder.encode(xmlContent).length;

    // Calcular total de peças
    const totalParts = allItems.reduce((acc: number, item: any) => acc + (item.quantity || 1), 0);

    // ─── Hash do arquivo para detecção de duplicidade ─────────
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(xmlContent));
    const fileHash = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, "0")).join("");

    // ─── Verificar duplicidade ────────────────────────────────
    const { data: existing } = await supabase
      .from("promob_import_batches")
      .select("id, status, order_code")
      .eq("file_hash", fileHash)
      .limit(1)
      .single();

    if (existing) {
      const { data: existingOrder } = await supabase
        .from("production_orders")
        .select("id")
        .eq("order_code", existing.order_code || project.orderCode)
        .single();

      return new Response(JSON.stringify({
        success: false,
        duplicate: true,
        existingBatchId: existing.id,
        existingOrderId: existingOrder?.id,
        message: "Este arquivo já foi importado anteriormente.",
        parsed,
      }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // ─── Verificar se pedido já existe (por order_code) ───────
    let existingOrderByCode = null;
    if (project.orderCode) {
      const { data } = await supabase
        .from("production_orders")
        .select("id, order_code, status")
        .eq("order_code", project.orderCode)
        .single();
      existingOrderByCode = data;
    }

    if (existingOrderByCode) {
      return new Response(JSON.stringify({
        success: false,
        duplicate: true,
        duplicateType: "order_code",
        existingOrderId: existingOrderByCode.id,
        message: `Pedido ${project.orderCode} já existe no sistema.`,
        parsed,
        canRevise: true,
      }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // ─── Salvar no storage ────────────────────────────────
    const now = new Date();
    const ext = fileType === "xlsx" ? "xlsx" : fileType === "csv" ? "csv" : fileType === "tsv" ? "tsv" : "xml";
    const storagePath = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}` +
      `/${project.orderCode || 'sem-pedido'}/v1/promob-original.${ext}`;

    const contentTypes: Record<string, string> = {
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      csv: "text/csv",
      tsv: "text/tab-separated-values",
      xml: "application/xml"
    };
    const contentType = contentTypes[fileType] || "application/octet-stream";

    let uploadData: Uint8Array | string;
    if (fileType === "xlsx") {
      uploadData = base64ToUint8Array(xmlContent);
    } else {
      uploadData = xmlContent;
    }

    await supabase.storage
      .from("productive-backups")
      .upload(storagePath, uploadData, {
        contentType,
        upsert: false,
      });

    // ─── Registrar lote de importação ─────────────────────────
    const retentionUntil = new Date(Date.now() + 4 * 365.25 * 24 * 60 * 60 * 1000).toISOString();
    const { data: importBatch, error: batchError } = await supabase
      .from("promob_import_batches")
      .insert({
        integration_id:        integrationId || null,
        source_type:           "xml_upload",
        file_name:             fileName || "import.xml",
        file_hash:             fileHash,
        promob_project_code:   project.code,
        promob_project_name:   project.name,
        customer_name:         project.customer,
        order_code:            project.orderCode,
        raw_xml_storage_path:  storagePath,
        status:                "parsed",
        imported_by:           user.id,
        imported_at:           now.toISOString(),
        file_size:             fileSize,
        total_parts:           totalParts,
        total_errors:          totalErrors,
        total_warnings:        totalWarnings,
        validated_at:          now.toISOString(),
        retention_until:       retentionUntil,
        backup_status:         "pending",
      })
      .select()
      .single();

    if (batchError) throw batchError;
    importBatchId = importBatch.id;

    // Registrar logs de importação iniciais
    await supabase.from("pcp_import_logs").insert([
      {
        import_file_id: importBatchId,
        user_id: user.id,
        action: "upload_started",
        message: "Upload do arquivo iniciado no Portal PCP",
        severity: "info"
      },
      {
        import_file_id: importBatchId,
        user_id: user.id,
        action: "upload_completed",
        message: `Upload concluído: ${fileName} (${(fileSize / 1024).toFixed(1)} KB)`,
        severity: "info"
      },
      {
        import_file_id: importBatchId,
        user_id: user.id,
        action: "validation_started",
        message: "Iniciando pré-validação do arquivo",
        severity: "info"
      },
      {
        import_file_id: importBatchId,
        user_id: user.id,
        action: totalErrors > 0 ? "validation_failed" : "validation_completed",
        message: totalErrors > 0 
          ? `Validação concluída com erros: ${totalErrors} erros e ${totalWarnings} alertas.`
          : `Validação concluída com sucesso: ${totalParts} peças encontradas.`,
        severity: totalErrors > 0 ? "error" : totalWarnings > 0 ? "warning" : "info"
      },
      {
        import_file_id: importBatchId,
        user_id: user.id,
        action: "import_confirmed",
        message: "Importação confirmada pelo usuário",
        severity: "info"
      }
    ]);

    // ─── Criar Ordem de Produção ──────────────────────────────
    const orderCode = project.orderCode || `OP-${Date.now()}`;
    const { data: productionOrder, error: orderError } = await supabase
      .from("production_orders")
      .insert({
        order_code:            orderCode,
        customer_name:         project.customer || "N/D",
        promob_project_id:     project.code,
        promob_project_name:   project.name,
        source:                "promob_xml",
        delivery_date:         project.deliveryDate || null,
        status:                "imported",
        created_by:            user.id,
      })
      .select()
      .single();

    if (orderError) throw orderError;

    // ─── Criar Lote ───────────────────────────────────────────
    const lotCode = project.lotCode || `LOTE-${orderCode}-001`;
    const { data: lot, error: lotError } = await supabase
      .from("production_lots")
      .insert({
        order_id:      productionOrder.id,
        lot_code:      lotCode,
        lot_sequence:  1,
        current_stage: "imported",
        status:        "planned",
        priority:      5,
      })
      .select()
      .single();

    if (lotError) throw lotError;

    // ─── Criar Itens do Lote ──────────────────────────────────
    const lotItemsPayload = allItems.map(item => ({
      lot_id:             lot.id,
      piece_code:         item.code,
      piece_name:         item.name,
      material:           item.material,
      color:              item.color,
      thickness:          item.thickness,
      width:              item.width,
      height:             item.height,
      quantity:           item.quantity,
      sheet_count:        item.sheet_count || 0,
      edge_meters:        item.edge_meters || 0,
      pieces_quantity:    item.pieces_quantity || item.quantity || 1,
      covers_quantity:    item.covers_quantity || 0,
      edge_front:         item.edgeFront,
      edge_back:          item.edgeBack,
      edge_left:          item.edgeLeft,
      edge_right:         item.edgeRight,
      requires_cut:       item.requiresCut,
      requires_edge:      item.requiresEdge,
      requires_cnc:       item.requiresCnc,
      requires_joinery:   item.requiresJoinery,
      requires_separation: item.requiresSeparation,
      requires_packaging:  item.requiresPackaging,
      requires_shipping:   item.requiresShipping,
      environment_name:   item.environmentName,
      module_name:        item.moduleName,
      status:             "pending",
      load_number:        item.loadNumber || null,
      order_number:       item.orderCode || orderCode || null,
      customer_name:      item.customer || project.customer || null,
    }));

    let insertedLotItems: any[] = [];
    if (lotItemsPayload.length > 0) {
      const { data: lotItems, error: itemsError } = await supabase
        .from("lot_items")
        .insert(lotItemsPayload)
        .select("id,lot_id,piece_code,piece_name,status,created_at,updated_at,load_number,order_number,customer_name,environment_name,sheet_count,edge_meters,pieces_quantity,covers_quantity");
      if (itemsError) throw itemsError;
      insertedLotItems = lotItems || [];
    }

    await createCollectionArtifacts(supabase, lot, insertedLotItems, allItems);

    // ─── Atualizar batch como processado ─────────────────────
    await supabase
      .from("promob_import_batches")
      .update({ 
        status: totalErrors > 0 ? "error" : "processed",
        generated_op_id: productionOrder.id
      })
      .eq("id", importBatchId);

    // Gravar log de conclusão
    await supabase.from("pcp_import_logs").insert({
      import_file_id: importBatchId,
      user_id: user.id,
      action: "import_completed",
      message: `Importação concluída com sucesso. OP ${orderCode} criada com ${totalParts} peças.`,
      severity: "info"
    });

    // ─── Registrar evento de importação no audit log ──────────
    await supabase.from("system_audit_logs").insert({
      user_id:     user.id,
      user_email:  user.email,
      action:      "promob_xml_import",
      entity:      "production_order",
      entity_id:   productionOrder.id,
      entity_label: orderCode,
      new_value:   { orderCode, lotCode, totalItems: allItems.length, summary },
      metadata:    { batchId: importBatchId, fileName },
      success:     true,
    });

    // ─── Disparar backup automático (assíncrono) ──────────────
    fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-productive-backup`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId:      productionOrder.id,
          lotId:        lot.id,
          batchId:      importBatchId,
          xmlContent,
          parsedData:   parsed,
          requestedBy:  user.id
        }),
      }
    ).catch(e => console.warn("Backup assíncrono falhou:", e.message));

    return new Response(JSON.stringify({
      success: true,
      data: {
        importBatchId:    importBatchId,
        productionOrderId: productionOrder.id,
        lotId:            lot.id,
        orderCode,
        lotCode,
        totalItems:       allItems.length,
        summary,
      },
    }), { headers: { ...CORS, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[promob-import-xml]", err);
    
    // Se falhar e o lote de importação já foi criado, atualizar para 'error'
    if (supabaseClient && importBatchId) {
      await supabaseClient
        .from("promob_import_batches")
        .update({ status: "error" })
        .eq("id", importBatchId);

      await supabaseClient.from("pcp_import_logs").insert({
        import_file_id: importBatchId,
        user_id: userId,
        action: "validation_failed",
        message: `Falha crítica durante processamento: ${err.message}`,
        severity: "critical"
      });
    }

    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/^data:.*;base64,/, "");
  const binary = atob(clean);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
