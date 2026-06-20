// Edge Function: promob-import-xml
// Processa upload de XML do Promob, grava no banco e dispara backup automático.
// SEGURANÇA: Toda operação de escrita passa por esta Edge Function (service role no servidor)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // ─── Auth ─────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Autenticação necessária");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    // Verifica token do usuário
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) throw new Error("Token inválido");

    // Verifica permissão (apenas admin e manager)
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!["admin", "manager"].includes(profile?.role)) {
      throw new Error("Permissão insuficiente para importar XML Promob");
    }

    // ─── Recebe payload ───────────────────────────────────────
    const body = await req.json();
    const { xmlContent, fileName, integrationId } = body;

    if (!xmlContent) throw new Error("xmlContent é obrigatório");

    // ─── Parse do XML ─────────────────────────────────────────
    // Chama a Edge Function promob-parse-order internamente
    const parseResp = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/promob-parse-order`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ xmlContent }),
      }
    );
    const parseResult = await parseResp.json();
    if (!parseResult.success) throw new Error(`Falha no parse: ${parseResult.error}`);

    const parsed = parseResult.data;
    const { project, allItems, summary } = parsed;

    // ─── Hash do arquivo para detecção de duplicidade ─────────
    const encoder = new TextEncoder();
    const data = encoder.encode(xmlContent);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
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
      // Detectar diferenças vs. importação anterior
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

    // ─── Salvar XML no storage ────────────────────────────────
    const now = new Date();
    const storagePath = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}` +
      `/${project.orderCode || 'sem-pedido'}/v1/promob-original.xml`;

    await supabase.storage
      .from("productive-backups")
      .upload(storagePath, xmlContent, {
        contentType: "application/xml",
        upsert: false,
      });

    // ─── Registrar lote de importação ─────────────────────────
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
        imported_at:           new Date().toISOString(),
      })
      .select()
      .single();

    if (batchError) throw batchError;

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
    const lotCode = `LOTE-${orderCode}-001`;
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
    }));

    if (lotItemsPayload.length > 0) {
      const { error: itemsError } = await supabase
        .from("lot_items")
        .insert(lotItemsPayload);
      if (itemsError) throw itemsError;
    }

    // ─── Atualizar batch como processado ─────────────────────
    await supabase
      .from("promob_import_batches")
      .update({ status: "processed" })
      .eq("id", importBatch.id);

    // ─── Registrar evento de importação no audit log ──────────
    await supabase.from("system_audit_logs").insert({
      user_id:     user.id,
      user_email:  user.email,
      action:      "promob_xml_import",
      entity:      "production_order",
      entity_id:   productionOrder.id,
      entity_label: orderCode,
      new_value:   { orderCode, lotCode, totalItems: allItems.length, summary },
      metadata:    { batchId: importBatch.id, fileName },
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
          batchId:      importBatch.id,
          xmlContent,
          parsedData:   parsed,
        }),
      }
    ).catch(e => console.warn("Backup assíncrono falhou:", e.message));

    return new Response(JSON.stringify({
      success: true,
      data: {
        importBatchId:    importBatch.id,
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
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
