import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function efficiency(produced, target) {
  if (!target) return 0;
  return Math.round((produced / target) * 100);
}

// Detecta células com eficiência < minEff% por minHours+ horas consecutivas (no dia informado)
function detectSustainedLowEfficiency(entries, minEff, minHours) {
  const byCell = {};
  entries.forEach((e) => {
    if (!e.cell || !e.hour || !(Number(e.target) > 0)) return;
    const k = e.cell;
    if (!byCell[k]) byCell[k] = {};
    const h = e.hour;
    if (!byCell[k][h]) byCell[k][h] = { produced: 0, target: 0 };
    byCell[k][h].produced += Number(e.produced) || 0;
    byCell[k][h].target += Number(e.target) || 0;
  });

  const alerts = [];
  Object.entries(byCell).forEach(([cell, hoursMap]) => {
    const hours = Object.keys(hoursMap).sort((a, b) => a.localeCompare(b));
    let runStart = -1;
    let bestRun = null;
    for (let i = 0; i <= hours.length; i++) {
      const h = hours[i];
      const data = h ? hoursMap[h] : null;
      const eff = data ? efficiency(data.produced, data.target) : null;
      const low = eff !== null && eff < minEff;
      if (low) {
        if (runStart === -1) runStart = i;
      } else {
        if (runStart !== -1) {
          const run = hours.slice(runStart, i);
          if (!bestRun || run.length > bestRun.length) bestRun = run;
          runStart = -1;
        }
      }
    }
    if (bestRun && bestRun.length >= minHours) {
      const lastH = bestRun[bestRun.length - 1];
      const lastEff = efficiency(hoursMap[lastH].produced, hoursMap[lastH].target);
      alerts.push({ cell, hours: bestRun, consecutive: bestRun.length, currentEff: lastEff, threshold: minEff });
    }
  });
  return alerts;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Data alvo: hoje no fuso de São Paulo
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const dateStr = today.toISOString().slice(0, 10);

    const entries = await base44.asServiceRole.entities.ProductionEntry.filter({ date: dateStr });
    const alerts = detectSustainedLowEfficiency(entries, 60, 3);

    if (alerts.length === 0) {
      return Response.json({ checked: dateStr, alerts: 0, sent: 0 });
    }

    const configs = await base44.asServiceRole.entities.NotificationConfig.list('-created_date', 1);
    const config = configs[0] || { emailEnabled: true, webhookEnabled: false };

    const managers = (await base44.asServiceRole.entities.Manager.list('-created_date', 500))
      .filter((m) => m.active !== false && m.email);

    let sent = 0;
    const results = [];

    for (const a of alerts) {
      const signature = `${dateStr}|${a.cell}|${a.hours.join(',')}`;
      const existing = await base44.asServiceRole.entities.AlertLog.filter({ signature });
      if (existing.length > 0) continue; // já notificado

      // gestores responsáveis: sem células = todas; senão precisa conter a célula
      const recipients = managers
        .filter((m) => !m.cells || m.cells.length === 0 || m.cells.includes(a.cell))
        .map((m) => m.email);

      const unique = [...new Set(recipients)];
      const subject = `⚠️ Eficiência crítica — Célula ${a.cell}`;
      const message = `Alerta automático de produção\n\n` +
        `A célula "${a.cell}" registrou eficiência abaixo de ${a.threshold}% por ${a.consecutive} horas consecutivas.\n\n` +
        `Eficiência atual: ${a.currentEff}%\n` +
        `Horas afetadas: ${a.hours.join(', ')}\n` +
        `Data: ${dateStr}\n\n` +
        `Recomenda-se verificar a célula imediatamente.`;

      if (config.emailEnabled !== false) {
        for (const email of unique) {
          await base44.asServiceRole.integrations.Core.SendEmail({ to: email, subject, body: message });
          sent++;
        }
      }

      if (config.webhookEnabled === true && config.webhookUrl) {
        await fetch(config.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `${subject}\n${message}` }),
        });
      }

      await base44.asServiceRole.entities.AlertLog.create({
        date: dateStr,
        cell: a.cell,
        signature,
        currentEff: a.currentEff,
        consecutiveHours: a.consecutive,
        recipients: unique,
      });

      results.push({ cell: a.cell, notified: unique.length });
    }

    return Response.json({ checked: dateStr, alerts: alerts.length, sent, results });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});