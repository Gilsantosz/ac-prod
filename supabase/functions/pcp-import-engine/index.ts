// Edge Function: pcp-import-engine
// Processamento transacional e auditável de arquivos PCP (XLSX, XLS, CSV, TSV, TXT, HTML, XML)
// SEGURANÇA: Executa no servidor e valida a sessão do usuário.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function cleanCell(val: unknown): string {
  if (val === undefined || val === null) return "";
  let s = String(val).trim();
  // Remove aspas duplas externas se houver
  if (s.startsWith('"') && s.endsWith('"')) {
    s = s.substring(1, s.length - 1).trim();
  }
  return s;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Inicializar Supabase Client herdando a credencial do usuário
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // 1. Obter arquivo da requisição (Multipart ou Body raw)
    let arrayBuffer: ArrayBuffer;
    let fileName = "upload.csv";
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File;
      if (!file) {
        return new Response(JSON.stringify({ error: "Nenhum arquivo enviado" }), {
          status: 400,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      arrayBuffer = await file.arrayBuffer();
      fileName = file.name;
    } else {
      arrayBuffer = await req.arrayBuffer();
    }

    // 2. Criar lote de importação inicial (promob_import_batches)
    const { data: batch, error: batchError } = await supabase
      .from("promob_import_batches")
      .insert({
        filename: fileName,
        status: "processing",
        created_by: (await supabase.auth.getUser()).data.user?.id,
      })
      .select()
      .single();

    if (batchError) throw batchError;

    // 3. Detectar se é formato binário (XLSX, XLS)
    const uint8 = new Uint8Array(arrayBuffer);
    const isXlsx = uint8[0] === 0x50 && uint8[1] === 0x4b && uint8[2] === 0x03 && uint8[3] === 0x04; // PK..
    const isXls = uint8[0] === 0xd0 && uint8[1] === 0xcf && uint8[2] === 0x11 && uint8[3] === 0xe0; // OLE..

    let rawRows: string[][] = [];

    if (isXlsx || isXls) {
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

      // Reconstruir linhas considerando a "Fragmentação por TAB no XLSX"
      for (let i = 0; i < sheetData.length; i++) {
        const rowData = sheetData[i];
        if (!rowData || rowData.length === 0) continue;
        
        // Unir células com espaço e depois fazer o split por ponto e vírgula
        const joined = rowData.map(c => String(c ?? '')).join(' ');
        if (joined.trim() === '') continue;

        const cols = joined.split(';');
        rawRows.push(cols);
      }
    } else {
      // 4. Decodificação Determinística de Texto (UTF-8 / ISO-8859-1 fallback)
      let text = "";
      try {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        text = decoder.decode(arrayBuffer);
        if (text.includes("\uFFFD")) {
          throw new Error("Caracteres corrompidos detectados.");
        }
      } catch (_) {
        const decoder = new TextDecoder("iso-8859-1");
        text = decoder.decode(arrayBuffer);
      }

      // Dividir linhas e colunas (semicolon ou tab)
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (line.trim() === '') continue;
        const delimiter = line.includes('\t') ? '\t' : ';';
        const cols = line.split(delimiter);
        rawRows.push(cols);
      }
    }

    // 5. Mapear e Validar as Linhas
    const validRows: any[] = [];
    const errorRows: any[] = [];
    const seenBarcodes = new Set<string>();
    
    // Buscar todos os barcodes existentes no banco para detectar colisões
    const { data: dbPieces } = await supabase
      .from("production_pieces")
      .select("piece_uid");
    const dbBarcodes = new Set(dbPieces?.map((p: any) => p.piece_uid) || []);

    let orderCode = "";
    let lotCode = "";
    let customer = "";
    let projectName = "";

    for (let i = 0; i < rawRows.length; i++) {
      const cols = rawRows[i];
      const rowNum = i + 1;

      // Garantir preenchimento mínimo
      const colsClean = cols.map(cleanCell);
      const barcode = colsClean[14] || "";
      const checkBarcode = colsClean[24] || "";
      const route = colsClean[26] || "";

      // Capturar metadados do pedido/lote a partir da primeira linha válida
      if (orderCode === "" && colsClean[1] !== "") orderCode = colsClean[1];
      if (lotCode === "" && colsClean[0] !== "") lotCode = colsClean[0];
      if (customer === "" && colsClean[2] !== "") customer = colsClean[2];
      if (projectName === "" && colsClean[3] !== "") projectName = colsClean[3];

      const rowPayload = {
        row_number: rowNum,
        raw_cells: cols,
        lotCode: colsClean[0] || "",
        orderCode: colsClean[1] || "",
        customer: colsClean[2] || "",
        projectName: colsClean[3] || "",
        environmentName: colsClean[4] || "",
        moduleName: colsClean[5] || "",
        pieceCode: colsClean[6] || "",
        pieceName: colsClean[7] || "",
        material: colsClean[8] || "",
        color: colsClean[9] || "",
        thickness: colsClean[10] || "",
        width: colsClean[11] || "",
        height: colsClean[12] || "",
        quantity: colsClean[13] || "",
        barcode: barcode,
        checkBarcode: checkBarcode,
        route: route,
      };

      const errors: string[] = [];

      // Validação: Barcode Vazio
      if (barcode === "") {
        errors.push("Código de barras (Coluna O) ausente ou vazio.");
      } else {
        // Validação: Divergência entre Coluna O e Y
        if (barcode !== checkBarcode) {
          errors.push(`Código de barras da Coluna O (${barcode}) divergente da Coluna Y (${checkBarcode}).`);
        }

        // Validação: Duplicidade interna no arquivo
        if (seenBarcodes.has(barcode)) {
          errors.push(`Código de barras duplicado no arquivo: ${barcode}.`);
        } else {
          seenBarcodes.add(barcode);
        }

        // Validação: Colisão com o banco de dados
        if (dbBarcodes.has(barcode)) {
          errors.push(`Código de barras já cadastrado no banco de dados: ${barcode}.`);
        }
      }

      if (errors.length > 0) {
        errorRows.push({
          row_number: rowNum,
          errors: errors,
          payload: rowPayload,
        });

        // Registrar no ledger como erro
        await supabase.from("pcp_import_rows").insert({
          batch_id: batch.id,
          row_number: rowNum,
          raw_cells: cols,
          normalized_payload: rowPayload,
          barcode_raw: barcode,
          barcode_normalized: barcode,
          validation_status: "error",
          validation_errors: errors,
          row_hash: "",
        });
      } else {
        validRows.push(rowPayload);
      }
    }

    // Caso a URL tenha o parâmetro commit=true, executa a transação
    const urlParams = new URL(req.url).searchParams;
    const shouldCommit = urlParams.get("commit") === "true";

    if (shouldCommit && validRows.length > 0) {
      // Definir valores padrão para metadados caso estejam ausentes
      const finalOrderCode = orderCode || `PED-${Date.now()}`;
      const finalLotCode = lotCode || `LOTE-${Date.now()}`;
      const finalCustomer = customer || "Consumidor Final";
      const finalProject = projectName || "Projeto Manual";

      // Chamar a RPC transacional commit_pcp_import
      const { data: commitRes, error: commitError } = await supabase.rpc(
        "commit_pcp_import",
        {
          p_batch_id: batch.id,
          p_order_code: finalOrderCode,
          p_lot_code: finalLotCode,
          p_customer: finalCustomer,
          p_project_name: finalProject,
          p_mapping_profile: "pcp_padrao_v1",
          p_mapping_version: 1,
          p_rows: validRows,
        }
      );

      if (commitError) throw commitError;

      return new Response(
        JSON.stringify({
          success: true,
          committed: true,
          batch_id: batch.id,
          lot_code: finalLotCode,
          order_code: finalOrderCode,
          total_lines: rawRows.length,
          valid_lines: validRows.length,
          error_lines: errorRows.length,
          errors: errorRows,
          commit_details: commitRes,
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // Caso contrário, apenas retorna a pré-visualização (preview)
    await supabase
      .from("promob_import_batches")
      .update({
        status: "pending_review",
        error_details: { preview_errors: errorRows },
      })
      .eq("id", batch.id);

    return new Response(
      JSON.stringify({
        success: true,
        committed: false,
        batch_id: batch.id,
        lot_code: lotCode,
        order_code: orderCode,
        customer: customer,
        project_name: projectName,
        total_lines: rawRows.length,
        valid_lines: validRows.length,
        error_lines: errorRows.length,
        errors: errorRows,
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Erro no PCP Import Engine:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
