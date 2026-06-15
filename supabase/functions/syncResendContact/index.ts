import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

Deno.serve(async (req) => {
  // Configuração de CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      }
    });
  }

  try {
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY não configurada.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    let body = {};
    try { body = await req.json(); } catch { body = {}; }

    const { action, email, oldEmail, name } = body;
    if (!action || !email) {
      return new Response(JSON.stringify({ error: 'Parâmetros action e email são obrigatórios.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const parts = (name || '').trim().split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';

    // Headers comuns do Resend
    const headers = {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'supabase-edge-function/1.0'
    };

    if (action === 'create') {
      console.log(`Criando contato no Resend: ${email} (${name})`);
      const res = await fetch('https://api.resend.com/contacts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email,
          firstName,
          lastName,
          unsubscribed: false
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(`Erro ao criar contato: ${JSON.stringify(data)}`);
      }
      return new Response(JSON.stringify({ success: true, data }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (action === 'update') {
      console.log(`Atualizando contato no Resend de ${oldEmail || email} para ${email} (${name})`);
      
      // 1. Procurar e remover o contato antigo (se o e-mail mudou, ou o próprio e-mail atual)
      const emailToFind = oldEmail || email;
      const listRes = await fetch('https://api.resend.com/contacts', {
        method: 'GET',
        headers
      });
      const listData = await listRes.json();
      if (listRes.ok && listData.data) {
        const existing = listData.data.find((c: any) => c.email?.toLowerCase() === emailToFind.toLowerCase());
        if (existing) {
          console.log(`Removendo contato antigo do Resend com ID ${existing.id}`);
          await fetch(`https://api.resend.com/contacts/${existing.id}`, {
            method: 'DELETE',
            headers
          });
        }
      }

      // 2. Criar o contato com os novos dados
      const res = await fetch('https://api.resend.com/contacts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email,
          firstName,
          lastName,
          unsubscribed: false
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(`Erro ao recriar contato atualizado: ${JSON.stringify(data)}`);
      }
      return new Response(JSON.stringify({ success: true, data }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (action === 'delete') {
      console.log(`Removendo contato do Resend: ${email}`);
      const listRes = await fetch('https://api.resend.com/contacts', {
        method: 'GET',
        headers
      });
      const listData = await listRes.json();
      if (listRes.ok && listData.data) {
        const existing = listData.data.find((c: any) => c.email?.toLowerCase() === email.toLowerCase());
        if (existing) {
          console.log(`Encontrado contato com ID ${existing.id}, deletando...`);
          const delRes = await fetch(`https://api.resend.com/contacts/${existing.id}`, {
            method: 'DELETE',
            headers
          });
          const delData = await delRes.json();
          return new Response(JSON.stringify({ success: true, data: delData }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
          });
        }
      }
      return new Response(JSON.stringify({ success: true, message: 'Contato não encontrado no Resend.' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    return new Response(JSON.stringify({ error: `Ação ${action} não suportada.` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error: any) {
    console.error('Erro na Edge Function syncResendContact:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
