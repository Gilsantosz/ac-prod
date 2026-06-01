import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DOWNTIME_THRESHOLD = 30; // minutos

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));

    // Payload da automação de entidade
    const event = body?.event || {};
    let occ = body?.data || null;
    if (!occ && event?.entity_id) {
      occ = await base44.asServiceRole.entities.Occurrence.get(event.entity_id).catch(() => null);
    }
    if (!occ) {
      return Response.json({ skipped: 'no occurrence data' });
    }

    const downtime = Number(occ.downtime) || 0;
    if (downtime <= DOWNTIME_THRESHOLD) {
      return Response.json({ skipped: 'below threshold', downtime });
    }

    // Configuração de notificações (e-mail / webhook)
    const configs = await base44.asServiceRole.entities.NotificationConfig.list('-created_date', 1);
    const config = configs[0] || { emailEnabled: true, webhookEnabled: false };

    const managers = (await base44.asServiceRole.entities.Manager.list('-created_date', 500))
      .filter((m) => m.active !== false && m.email);

    const recipients = [...new Set(
      managers
        .filter((m) => !m.cells || m.cells.length === 0 || m.cells.includes(occ.cell))
        .map((m) => m.email)
    )];

    const subject = `🛑 Parada longa — Célula ${occ.cell} (${downtime} min)`;
    const message =
      `Alerta automático de parada\n\n` +
      `A célula "${occ.cell}" registrou uma parada de ${downtime} minutos.\n\n` +
      `Motivo: ${occ.reason || '-'}\n` +
      `Turno: ${occ.shift || '-'}\n` +
      `Data: ${occ.date || '-'}\n` +
      `Operador: ${occ.operator || '-'}\n` +
      (occ.notes ? `Detalhes: ${occ.notes}\n` : '') +
      `\nLimite configurado: ${DOWNTIME_THRESHOLD} min.`;

    let emailsSent = 0;
    if (config.emailEnabled !== false) {
      for (const email of recipients) {
        await base44.asServiceRole.integrations.Core.SendEmail({ to: email, subject, body: message });
        emailsSent++;
      }
    }

    let webhookSent = false;
    if (config.webhookEnabled === true && config.webhookUrl) {
      await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `${subject}\n${message}` }),
      });
      webhookSent = true;
    }

    return Response.json({ notified: true, downtime, emailsSent, webhookSent, recipients: recipients.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});