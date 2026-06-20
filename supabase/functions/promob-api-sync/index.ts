// Edge Function: promob-api-sync
// Sincroniza dados da API Promob, armazena tokens no Vault e testa conexões.
// SEGURANÇA: Comunicação segura com banco de dados usando SERVICE_ROLE_KEY.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let body: any = {};

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
      throw new Error("Permissão insuficiente para configurar integração Promob");
    }

    // ─── Recebe payload ───────────────────────────────────────
    body = await req.json();
    const { action, integrationId, token } = body;

    if (!action) throw new Error("action é obrigatório");

    // ─── 1. Armazenar Token no Vault ─────────────────────────
    if (action === "store_token") {
      if (!integrationId) throw new Error("integrationId é obrigatório para store_token");
      if (!token) throw new Error("token é obrigatório para store_token");

      console.log(`Armazenando token para integração: ${integrationId}`);
      
      const { data: secretId, error: rpcError } = await supabase.rpc("store_promob_token", {
        integration_id: integrationId,
        token_text: token,
      });

      if (rpcError) throw rpcError;

      return new Response(JSON.stringify({ success: true, secretId }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ─── 2. Testar Conexão com a API ──────────────────────────
    if (action === "test" || action === "sync") {
      if (!integrationId) throw new Error("integrationId é obrigatório");

      // Buscar URL e detalhes da integração
      const { data: integration, error: getIntegError } = await supabase
        .from("promob_integrations")
        .select("*")
        .eq("id", integrationId)
        .single();

      if (getIntegError || !integration) throw new Error("Integração não encontrada");
      if (!integration.api_url) throw new Error("URL da API não configurada");

      // Buscar token descriptografado do Vault
      const { data: decryptedToken, error: getTokenError } = await supabase.rpc("get_promob_token", {
        integration_id: integrationId,
      });

      if (getTokenError) throw new Error("Falha ao recuperar token do Vault");
      if (!decryptedToken) throw new Error("Nenhum token configurado no Vault");

      console.log(`Conectando à API: ${integration.api_url}`);

      // Executa chamada HTTP para a API Promob
      const apiResp = await fetch(integration.api_url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${decryptedToken}`,
          "Accept": "application/xml, application/json",
        },
      });

      if (action === "test") {
        if (!apiResp.ok && apiResp.status !== 404) {
          throw new Error(`Servidor respondeu com status ${apiResp.status}`);
        }
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      // ─── 3. Sincronizar (Apenas para action === "sync") ───────
      const responseText = await apiResp.text();
      if (!apiResp.ok) {
        throw new Error(`Erro ao buscar dados da API: Status ${apiResp.status} - ${responseText.substring(0, 100)}`);
      }

      let xmlContent = "";
      if (responseText.trim().startsWith("<")) {
        xmlContent = responseText;
      } else {
        // Se a API retornou JSON, converte para XML ou lança erro dependendo do parser
        // Aqui assumimos que a API padrão retorna XML
        throw new Error("A API não retornou um formato XML válido.");
      }

      // Reutiliza o mesmo fluxo de importação do XML
      const importResp = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/promob-import-xml`,
        {
          method: "POST",
          headers: {
            "Authorization": authHeader,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            xmlContent,
            fileName: `sync_api_${Date.now()}.xml`,
            integrationId,
          }),
        }
      );

      const importResult = await importResp.json();
      if (!importResp.ok || !importResult.success) {
        throw new Error(`Falha ao processar importação: ${importResult.error || importResult.message}`);
      }

      // Atualizar status de sucesso na integração
      await supabase
        .from("promob_integrations")
        .update({
          last_sync_at: new Date().toISOString(),
          last_success_at: new Date().toISOString(),
          last_error_message: null,
        })
        .eq("id", integrationId);

      return new Response(JSON.stringify({ success: true, imported: importResult.data?.totalItems || 0 }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    throw new Error(`Ação ${action} não suportada.`);

  } catch (err: any) {
    const message = err?.message || String(err);
    console.error("[promob-api-sync]", err);

    // Se falhou no sync, grava o erro na integração
    if (body?.integrationId && body?.action === "sync") {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          { auth: { persistSession: false } }
        );
        await supabase
          .from("promob_integrations")
          .update({
            last_sync_at: new Date().toISOString(),
            last_error_at: new Date().toISOString(),
            last_error_message: message,
          })
          .eq("id", body.integrationId);
      } catch (dbErr) {
        console.error("Falha ao salvar erro no banco:", dbErr);
      }
    }

    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
