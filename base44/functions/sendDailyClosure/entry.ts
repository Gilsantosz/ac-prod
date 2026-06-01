import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const fmt = (n) => (Number(n) || 0).toLocaleString('pt-BR');

function acc(list) {
  const produced = list.reduce((a, e) => a + (Number(e.produced) || 0), 0);
  const scrap = list.reduce((a, e) => a + (Number(e.scrap) || 0), 0);
  const downtime = list.reduce((a, e) => a + (Number(e.downtime) || 0), 0);
  const good = Math.max(produced - scrap, 0);
  const scrapRate = produced > 0 ? Math.round((scrap / produced) * 1000) / 10 : 0;
  return { produced, scrap, good, downtime, scrapRate };
}

function buildHtml(dateStr, entries) {
  const total = acc(entries);

  const byCellMap = {};
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let body = {};
    try { body = await req.json(); } catch { body = {}; }

    // Data alvo: payload (envio manual = dia da tela) ou, no agendamento, o dia anterior (UTC)
    let dateStr = body.date;
    if (!dateStr) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - 1);
      dateStr = d.toISOString().slice(0, 10);
    }

    const entries = await base44.asServiceRole.entities.ProductionEntry.filter({ date: dateStr }, '-created_date', 2000);

    const configs = await base44.asServiceRole.entities.NotificationConfig.list('-created_date', 1);
    const config = configs[0] || { emailEnabled: true };

    const managers = (await base44.asServiceRole.entities.Manager.list('-created_date', 500))
      .filter((m) => m.active !== false && m.email);
    const recipients = [...new Set(managers.map((m) => m.email))];

    if (config.emailEnabled === false || recipients.length === 0) {
      return Response.json({ date: dateStr, sent: 0, reason: recipients.length === 0 ? 'no_recipients' : 'email_disabled' });
    }

    const subject = `📋 Fechamento de Turno — ${dateStr}`;
    const html = buildHtml(dateStr, entries);

    let sent = 0;
    for (const email of recipients) {
      await base44.asServiceRole.integrations.Core.SendEmail({ to: email, subject, body: html });
      sent++;
    }

    return Response.json({ date: dateStr, sent, recipients });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});