import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const fmt = (n: number | string) => (Number(n) || 0).toLocaleString('pt-BR');

function acc(list: any[]) {
  const produced = list.reduce((a, e) => a + (Number(e.produced) || 0), 0);
  const scrap = list.reduce((a, e) => a + (Number(e.scrap) || 0), 0);
  const downtime = list.reduce((a, e) => a + (Number(e.downtime) || 0), 0);
  const good = Math.max(produced - scrap, 0);
  const scrapRate = produced > 0 ? Math.round((scrap / produced) * 1000) / 10 : 0;
  return { produced, scrap, good, downtime, scrapRate };
}

function buildHtml(dateStr: string, entries: any[]) {
  const total = acc(entries);

  const byCellMap: Record<string, any[]> = {};
  entries.forEach((e) => {
    if (!e.cell) return;
    (byCellMap[e.cell] = byCellMap[e.cell] || []).push(e);
  });
  const rows = Object.entries(byCellMap)
    .map(([cell, list]) => ({ cell, ...acc(list) }))
    .sort((a, b) => b.produced - a.produced);

  const cellRows = rows.map((r) => `
    <tr>
      <td style="padding:6px 10px;border:1px solid #e2e8f0">${r.cell}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right">${fmt(r.produced)}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right">${fmt(r.good)}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right">${fmt(r.scrap)}</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right">${r.scrapRate}%</td>
      <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right">${fmt(r.downtime)}</td>
    </tr>`).join('');

  return `
  <div style="font-family:Arial,sans-serif;color:#0f172a;max-width:680px">
    <h2 style="margin:0 0 4px">Relatório de Fechamento de Turno</h2>
    <p style="color:#64748b;margin:0 0 16px">Data: ${dateStr}</p>
    <table style="border-collapse:collapse;width:100%;margin-bottom:20px">
      <tr><td style="padding:8px;background:#f1f5f9;border:1px solid #e2e8f0"><b>Produzido</b></td><td style="padding:8px;border:1px solid #e2e8f0">${fmt(total.produced)}</td></tr>
      <tr><td style="padding:8px;background:#f1f5f9;border:1px solid #e2e8f0"><b>Peças Boas</b></td><td style="padding:8px;border:1px solid #e2e8f0">${fmt(total.good)}</td></tr>
      <tr><td style="padding:8px;background:#f1f5f9;border:1px solid #e2e8f0"><b>Refugo</b></td><td style="padding:8px;border:1px solid #e2e8f0">${fmt(total.scrap)} (${total.scrapRate}%)</td></tr>
      <tr><td style="padding:8px;background:#f1f5f9;border:1px solid #e2e8f0"><b>Paradas (min)</b></td><td style="padding:8px;border:1px solid #e2e8f0">${fmt(total.downtime)}</td></tr>
    </table>
    <h3 style="margin:0 0 8px">Produção por Célula</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <thead>
        <tr style="background:#0f172a;color:#fff">
          <th style="padding:6px 10px;text-align:left">Célula</th>
          <th style="padding:6px 10px;text-align:right">Produzido</th>
          <th style="padding:6px 10px;text-align:right">Boas</th>
          <th style="padding:6px 10px;text-align:right">Refugo</th>
          <th style="padding:6px 10px;text-align:right">% Refugo</th>
          <th style="padding:6px 10px;text-align:right">Paradas (min)</th>
        </tr>
      </thead>
      <tbody>${cellRows || '<tr><td colspan="6" style="padding:10px;text-align:center;border:1px solid #e2e8f0">Sem dados</td></tr>'}</tbody>
    </table>
  </div>`;
}

// Envia e-mail via Gmail SMTP usando raw TCP (sem biblioteca externa)
async function sendGmailSmtp(opts: {
  user: string;
  pass: string;
  to: string[];
  subject: string;
  html: string;
}) {
  // Usa a API do Gmail via fetch com autenticação OAuth não é viável em edge functions
  // Usamos nodemailer via npm: compatível com Deno via esm.sh
  const nodemailer = (await import("npm:nodemailer@6.9.9")).default;

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: opts.user,
      pass: opts.pass,
    },
  });

  const errors: string[] = [];
  let sentCount = 0;

  for (const to of opts.to) {
    try {
      await transporter.sendMail({
        from: `"Controle de Produção" <${opts.user}>`,
        to,
        subject: opts.subject,
        html: opts.html,
        text: "Por favor, use um cliente de e-mail que suporte HTML.",
      });
      sentCount++;
      console.log(`✓ E-mail enviado para: ${to}`);
    } catch (err: any) {
      console.error(`✗ Falha para ${to}: ${err.message}`);
      errors.push(`${to}: ${err.message}`);
    }
  }

  return { sentCount, errors };
}

Deno.serve(async (req) => {
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase = createClient(supabaseUrl, supabaseServiceRole);

    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }

    let dateStr = body.date;
    if (!dateStr) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 1);
      dateStr = d.toISOString().slice(0, 10);
    }

    const smtpUser = Deno.env.get('SMTP_USER');
    const smtpPass = Deno.env.get('SMTP_PASS');

    if (!smtpUser || !smtpPass) {
      return new Response(JSON.stringify({
        error: 'Credenciais SMTP não configuradas. Configure SMTP_USER e SMTP_PASS nas secrets do Supabase.'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // Buscar lançamentos de produção
    const { data: entries, error: entriesError } = await supabase
      .from('production_entries')
      .select('*')
      .eq('date', dateStr);

    if (entriesError) throw entriesError;

    // Buscar gestores ativos
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('email, active')
      .eq('role', 'manager');

    if (profilesError) throw profilesError;

    const activeManagers = (profiles || []).filter((m: any) => m.active !== false && m.email);
    const recipients = [...new Set(activeManagers.map((m: any) => m.email as string))];

    if (recipients.length === 0) {
      return new Response(JSON.stringify({ date: dateStr, sent: 0, reason: 'no_recipients' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const subject = `Fechamento de Turno - ${dateStr}`;
    const htmlBody = buildHtml(dateStr, entries || []);

    const { sentCount, errors } = await sendGmailSmtp({
      user: smtpUser,
      pass: smtpPass,
      to: recipients,
      subject,
      html: htmlBody,
    });

    return new Response(JSON.stringify({
      date: dateStr,
      sent: sentCount,
      recipients,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
});
