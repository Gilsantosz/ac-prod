import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    console.log('[sendDailyClosure] Acionando pipeline centralizado send-scheduled-reports...');

    // Invoca a Edge Function centralizada
    const response = await fetch(`${supabaseUrl}/functions/v1/send-scheduled-reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceRole}`
      },
      body: JSON.stringify({})
    });

    let result = {};
    try {
      result = await response.json();
    } catch (_) {
      // Ignorar se não for JSON
    }

    console.log('[sendDailyClosure] Resposta do pipeline centralizado:', result);

    return new Response(JSON.stringify({
      success: true,
      message: 'Pipeline centralizado de agendamentos acionado com sucesso.',
      result
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[sendDailyClosure] Erro ao acionar pipeline centralizado:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
