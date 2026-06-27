import { Buffer } from "node:buffer";
import { createClient } from "https:
import { PDFDocument, StandardFonts, rgb } from "https:
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const REPORT_TYPE_LABELS: Record<string, string> = {
  daily_production: 'Produção Diária',
  shift_closure: 'Fechamento de Turno',
  oee: 'Indicadores OEE (Últimos 7 dias)',
  traceability_pending: 'Rastreabilidade Pendente',
  lots_delayed: 'Lotes em Atraso',
  packaging_pending: 'Embalagem Pendente',
  shipping_pending: 'Expedição Pendente',
  executive_summary: 'Resumo Executivo'
};
const LEO_LOGO_URL = "https:
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabase = createClient(supabaseUrl, supabaseServiceRole);
  try {
    let body: any = {};
    try { body = await req.json(); } catch { body = {}; }
    const { scheduleId, test } = body;
    let schedulesToProcess = [];
    if (scheduleId) {
      const { data, error } = await supabase
        .from('report_schedules')
        .select('*')
        .eq('id', scheduleId)
        .single();
      if (error) throw error;
      if (data) schedulesToProcess.push(data);
    } else {
      const { data, error } = await supabase
        .from('report_schedules')
        .select('*')
        .eq('enabled', true)
        .or(`next_run_at.lte.${new Date().toISOString()},next_run_at.is.null`);
      if (error) throw error;
      if (data) schedulesToProcess = data;
    }
    const results = [];
    for (const schedule of schedulesToProcess) {
      try {
        console.log(`Processando agendamento: ${schedule.name} (${schedule.id})`);
        const recipientEmails: string[] = [];
        if (schedule.recipient_profile_ids && schedule.recipient_profile_ids.length > 0) {
          const { data: profiles, error: pError } = await supabase
            .from('profiles')
            .select('email')
            .in('id', schedule.recipient_profile_ids);
          if (!pError && profiles) {
            profiles.forEach((p: any) => {
              if (p.email) recipientEmails.push(p.email);
            });
          }
        }
        if (schedule.extra_emails && schedule.extra_emails.length > 0) {
          schedule.extra_emails.forEach((email: string) => {
            if (email && email.includes('@')) {
              recipientEmails.push(email);
            }
          });
        }
        const recipients = [...new Set(recipientEmails)];
        if (recipients.length === 0) {
          console.log(`Nenhum destinatário encontrado para o agendamento: ${schedule.name}`);
          continue;
        }
        const reportTypes = (schedule.report_types && schedule.report_types.length > 0)
          ? schedule.report_types
          : (schedule.report_type ? [schedule.report_type] : []);
        if (reportTypes.length === 0) {
          console.log(`Nenhum tipo de relatório configurado para o agendamento: ${schedule.name}`);
          continue;
        }
        let combinedHtmlBody = '';
        const attachments: any[] = [];
        let cellsData: any[] = [];
        if (reportTypes.includes('oee')) {
          const { data: cells } = await supabase.from('cells').select('*');
          cellsData = cells || [];
        }
        for (const type of reportTypes) {
          const reportData = await fetchReportDataForType(supabase, type, schedule);
          const fragmentHtml = renderReportFragmentHtml(type, reportData, cellsData);
          combinedHtmlBody += `
            <div style="margin-bottom: 40px; border-bottom: 1px solid #f1f5f9; padding-bottom: 25px;">
              <h2 style="color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 16px; font-family:sans-serif; font-size: 16px;">
                ${REPORT_TYPE_LABELS[type] || type}
              </h2>
              ${fragmentHtml}
            </div>
          `;
          if (schedule.format === 'csv' || schedule.format === 'pdf' || schedule.format === 'xlsx') {
            const filenameBase = `${safeFilename(schedule.name)}_${type}`;
            if (schedule.format === 'pdf') {
              const pdfBytes = await generateReportPdf(type, reportData, schedule);
              attachments.push({
                filename: `${filenameBase}.pdf`,
                content: Buffer.from(pdfBytes).toString('base64'),
                contentType: 'application/pdf'
              });
            } else if (schedule.format === 'xlsx') {
              const excelContent = generateReportExcelHtml(type, reportData, schedule);
              attachments.push({
                filename: `${filenameBase}.xls`,
                content: Buffer.from(excelContent, 'utf8').toString('base64'),
                contentType: 'application/vnd.ms-excel'
              });
            } else {
              const csvContent = generateReportCsv(type, reportData, schedule);
              attachments.push({
                filename: `${filenameBase}.csv`,
                content: Buffer.from(csvContent, 'utf8').toString('base64'),
                contentType: 'text/csv'
              });
            }
          }
        }
        const htmlContent = wrapEmailTemplate(schedule, combinedHtmlBody);
        const sent = await sendEmail({
          recipients,
          subject: `[AC.Prod] ${schedule.name}`,
          html: htmlContent,
          attachments
        });
        for (const email of recipients) {
          await supabase.from('report_delivery_logs').insert({
            report_schedule_id: schedule.id,
            recipient_email: email,
            status: sent.success ? 'sent' : 'failed',
            error_message: sent.error || null,
          });
        }
        if (!test) {
          const nextRun = calculateNextRun(schedule.frequency, schedule.time_local);
          await supabase
            .from('report_schedules')
            .update({
              last_sent_at: new Date().toISOString(),
              next_run_at: nextRun.toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', schedule.id);
        }
        results.push({ scheduleId: schedule.id, name: schedule.name, success: sent.success });
      } catch (err: any) {
        console.error(`Erro ao processar agendamento ${schedule.id}:`, err);
        results.push({ scheduleId: schedule.id, name: schedule.name, success: false, error: err.message });
      }
    }
    return new Response(JSON.stringify({ success: true, processed: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error: any) {
    console.error('Erro na Edge Function send-scheduled-reports:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
async function fetchReportDataForType(supabase: any, type: string, schedule: any) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const targetDate = schedule.frequency === 'daily' || schedule.frequency === 'workdays' ? yesterday : today;
  if (type === 'daily_production' || type === 'shift_closure') {
    let q = supabase.from('production_entries').select('*').eq('date', targetDate);
    if (schedule.cell_filter && schedule.cell_filter.length > 0) {
      q = q.in('cell', schedule.cell_filter);
    }
    const { data } = await q;
    return data || [];
  }
  if (type === 'oee') {
    const dateLimit = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    let q = supabase.from('production_entries').select('*').gte('date', dateLimit);
    if (schedule.cell_filter && schedule.cell_filter.length > 0) {
      q = q.in('cell', schedule.cell_filter);
    }
    const { data: entries } = await q;
    return entries || [];
  }
  if (type === 'traceability_pending') {
    const { data } = await supabase
      .from('production_lots')
      .select('*, production_orders(*)')
      .neq('status', 'finished')
      .order('created_at', { ascending: false });
    return data || [];
  }
  if (type === 'lots_delayed') {
    const { data } = await supabase
      .from('production_lots')
      .select('*, production_orders(*)')
      .neq('status', 'finished')
      .lt('delivery_date', new Date().toISOString());
    return data || [];
  }
  if (type === 'packaging_pending') {
    const { data } = await supabase
      .from('production_lots')
      .select('*, production_orders(*)')
      .eq('status', 'packaging')
      .order('created_at', { ascending: false });
    return data || [];
  }
  if (type === 'shipping_pending') {
    const { data } = await supabase
      .from('packages')
      .select('*, shipments(*)')
      .neq('status', 'shipped')
      .order('created_at', { ascending: false });
    return data || [];
  }
  if (type === 'executive_summary') {
    const { data: delayedLots } = await supabase
      .from('production_lots')
      .select('id')
      .neq('status', 'finished')
      .lt('delivery_date', new Date().toISOString());
    const { data: activeOccurrences } = await supabase
      .from('occurrences')
      .select('*')
      .eq('status', 'open');
    return {
      delayedCount: delayedLots?.length || 0,
      activeOccurrences: activeOccurrences || []
    };
  }
  return [];
}
const fmt = (n: number | string) => (Number(n) || 0).toLocaleString('pt-BR');
function acc(list: any[]) {
  const produced = list.reduce((a, e) => a + (Number(e.produced) || 0), 0);
  const scrap = list.reduce((a, e) => a + (Number(e.scrap) || 0), 0);
  const downtime = list.reduce((a, e) => a + (Number(e.downtime) || 0), 0);
  const good = Math.max(produced - scrap, 0);
  const scrapRate = produced > 0 ? Math.round((scrap / produced) * 1000) / 10 : 0;
  return { produced, scrap, good, downtime, scrapRate };
}
const pct = (n: number) => Math.round(n * 100 * 10) / 10;
function computeOeeStats(entries: any[], getCell: (cellName: string) => any) {
  const produced = entries.reduce((a, e) => a + (Number(e.produced) || 0), 0);
  const target = entries.reduce((a, e) => a + (Number(e.target) || 0), 0);
  const scrap = entries.reduce((a, e) => a + (Number(e.scrap) || 0), 0);
  const downtimeMin = entries.reduce((a, e) => a + (Number(e.downtime) || 0), 0);
  const seen = new Set();
  let plannedMin = 0;
  entries.forEach((e) => {
    const k = `${e.date}|${e.cell}|${e.shift}`;
    if (seen.has(k)) return;
    seen.add(k);
    const cell = getCell ? getCell(e.cell) : null;
    const sh = cell ? (cell.shift_hours || {}) : {};
    let hours = 8;
    if (e.shift === '1º Turno') hours = Number(sh.shift1 ?? 8);
    else if (e.shift === '2º Turno') hours = Number(sh.shift2 ?? 8);
    else if (e.shift === '3º Turno') hours = Number(sh.shift3 ?? 8);
    plannedMin += hours * 60;
  });
  const operatingMin = Math.max(plannedMin - downtimeMin, 0);
  const availability = plannedMin > 0 ? operatingMin / plannedMin : 0;
  const performance = target > 0 ? Math.min(produced / target, 1.5) : 0;
  const goodParts = Math.max(produced - scrap, 0);
  const quality = produced > 0 ? goodParts / produced : 0;
  const oee = availability * performance * quality;
  return {
    availability: pct(availability),
    performance: pct(performance),
    quality: pct(quality),
    oee: pct(oee),
    plannedMin,
    operatingMin,
    downtimeMin,
    produced,
    target,
    scrap,
    goodParts,
  };
}
function computeOeeByCell(entries: any[], cells: any[]) {
  const getCell = (cellName: string) => cells?.find(c => c.name === cellName) || null;
  const byCell: Record<string, any[]> = {};
  entries.forEach((e) => {
    if (!e.cell) return;
    (byCell[e.cell] = byCell[e.cell] || []).push(e);
  });
  return Object.entries(byCell)
    .map(([cell, list]) => ({ cell, ...computeOeeStats(list, getCell) }))
    .sort((a, b) => a.oee - b.oee);
}
function renderReportFragmentHtml(type: string, data: any, cellsData?: any[]) {
  if (type === 'daily_production' || type === 'shift_closure') {
    const entries = data as any[];
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
        <td style="padding:6px 10px;border:1px solid #e2e8f0;font-family:sans-serif;">${r.cell}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${fmt(r.produced)}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${fmt(r.good)}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${fmt(r.scrap)}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${r.scrapRate}%</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${fmt(r.downtime)}</td>
      </tr>`).join('');
    return `
      <h3 style="font-family:sans-serif;font-size:14px;color:#0f172a;margin-top:0;">Resumo Geral de Produção</h3>
      <table style="border-collapse:collapse;width:100%;margin-bottom:20px;font-family:sans-serif;font-size:13px;">
        <tr style="background:#f8fafc;"><td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;">Total Produzido</td><td style="padding:10px;border:1px solid #e2e8f0;">${fmt(total.produced)} peças</td></tr>
        <tr><td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;">Peças Boas</td><td style="padding:10px;border:1px solid #e2e8f0;">${fmt(total.good)} peças</td></tr>
        <tr style="background:#f8fafc;"><td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;">Total Refugado</td><td style="padding:10px;border:1px solid #e2e8f0;">${fmt(total.scrap)} peças (${total.scrapRate}%)</td></tr>
        <tr><td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;">Minutos de Parada</td><td style="padding:10px;border:1px solid #e2e8f0;">${fmt(total.downtime)} min</td></tr>
      </table>
      <h3 style="font-family:sans-serif;font-size:14px;color:#0f172a;">Produção por Célula</h3>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;">
        <thead>
          <tr style="background:#0f172a;color:#fff;">
            <th style="padding:6px 10px;text-align:left;">Célula</th>
            <th style="padding:6px 10px;text-align:right;">Produzido</th>
            <th style="padding:6px 10px;text-align:right;">Boas</th>
            <th style="padding:6px 10px;text-align:right;">Refugo</th>
            <th style="padding:6px 10px;text-align:right;">% Refugo</th>
            <th style="padding:6px 10px;text-align:right;">Paradas (min)</th>
          </tr>
        </thead>
        <tbody>
          ${cellRows || '<tr><td colspan="6" style="padding:15px;text-align:center;color:#64748b;">Nenhum registro para o período.</td></tr>'}
        </tbody>
      </table>
    `;
  }
  if (type === 'oee') {
    const entries = data as any[];
    const getCell = (cellName: string) => cellsData?.find(c => c.name === cellName) || null;
    const overall = computeOeeStats(entries, getCell);
    const byCell = computeOeeByCell(entries, cellsData || []);
    const byCellRows = byCell.map(r => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;font-family:sans-serif;font-weight:bold;">${r.cell}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;font-weight:bold;color:#0f172a;">${r.oee}%</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${r.availability}%</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${r.performance}%</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${r.quality}%</td>
      </tr>
    `).join('');
    return `
      <h3 style="font-family:sans-serif;font-size:14px;color:#0f172a;margin-top:0;">Indicadores OEE (Global)</h3>
      <table style="border-collapse:collapse;width:100%;margin-bottom:20px;font-family:sans-serif;font-size:13px;">
        <tr style="background:#f8fafc;">
          <td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;font-family:sans-serif;">OEE Global</td>
          <td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;color:#0f172a;font-family:sans-serif;">${overall.oee}%</td>
        </tr>
        <tr>
          <td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;font-family:sans-serif;">Disponibilidade</td>
          <td style="padding:10px;border:1px solid #e2e8f0;font-family:sans-serif;">${overall.availability}% (${fmt(overall.downtimeMin)} min de parada)</td>
        </tr>
        <tr style="background:#f8fafc;">
          <td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;font-family:sans-serif;">Performance</td>
          <td style="padding:10px;border:1px solid #e2e8f0;font-family:sans-serif;">${overall.performance}% (${fmt(overall.produced)} produzidas / ${fmt(overall.target)} meta)</td>
        </tr>
        <tr>
          <td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;font-family:sans-serif;">Qualidade</td>
          <td style="padding:10px;border:1px solid #e2e8f0;font-family:sans-serif;">${overall.quality}% (${fmt(overall.goodParts)} boas / ${fmt(overall.scrap)} refugo)</td>
        </tr>
      </table>
      <h3 style="font-family:sans-serif;font-size:14px;color:#0f172a;">OEE por Célula</h3>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;">
        <thead>
          <tr style="background:#0f172a;color:#fff;">
            <th style="padding:6px 10px;text-align:left;">Célula</th>
            <th style="padding:6px 10px;text-align:right;">OEE</th>
            <th style="padding:6px 10px;text-align:right;">Disponibilidade</th>
            <th style="padding:6px 10px;text-align:right;">Performance</th>
            <th style="padding:6px 10px;text-align:right;">Qualidade</th>
          </tr>
        </thead>
        <tbody>
          ${byCellRows || '<tr><td colspan="5" style="padding:15px;text-align:center;color:#64748b;">Nenhum dado OEE registrado nos últimos 7 dias.</td></tr>'}
        </tbody>
      </table>
    `;
  }
  if (type === 'traceability_pending' || type === 'lots_delayed' || type === 'packaging_pending') {
    const lots = data as any[];
    return `
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;">
        <thead>
          <tr style="background:#0f172a;color:#fff;">
            <th style="padding:8px;text-align:left;">Código Lote</th>
            <th style="padding:8px;text-align:left;">Ordem de Produção</th>
            <th style="padding:8px;text-align:left;">Status Atual</th>
            <th style="padding:8px;text-align:left;">Prazo Entrega</th>
          </tr>
        </thead>
        <tbody>
          ${lots.map(l => `
            <tr>
              <td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold;font-family:sans-serif;">${l.lot_code || ''}</td>
              <td style="padding:8px;border:1px solid #e2e8f0;font-family:sans-serif;">${l.production_orders?.order_code || ''}</td>
              <td style="padding:8px;border:1px solid #e2e8f0;font-family:sans-serif;"><span style="padding:2px 6px;border-radius:4px;background:#f1f5f9;font-size:11px;">${l.status || ''}</span></td>
              <td style="padding:8px;border:1px solid #e2e8f0;font-family:sans-serif;">${l.delivery_date ? new Date(l.delivery_date).toLocaleDateString('pt-BR') : '-'}</td>
            </tr>
          `).join('') || '<tr><td colspan="4" style="padding:15px;text-align:center;color:#64748b;font-family:sans-serif;">Nenhum lote correspondente encontrado.</td></tr>'}
        </tbody>
      </table>
    `;
  }
  if (type === 'shipping_pending') {
    const packages = data as any[];
    return `
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;">
        <thead>
          <tr style="background:#0f172a;color:#fff;">
            <th style="padding:8px;text-align:left;">Código Embalagem</th>
            <th style="padding:8px;text-align:left;">Volume</th>
            <th style="padding:8px;text-align:left;">Status</th>
            <th style="padding:8px;text-align:left;">Remessa</th>
            <th style="padding:8px;text-align:left;">Criado em</th>
          </tr>
        </thead>
        <tbody>
          ${packages.map(p => `
            <tr>
              <td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold;font-family:sans-serif;">${p.package_code || ''}</td>
              <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${p.volume_number || 1}</td>
              <td style="padding:8px;border:1px solid #e2e8f0;font-family:sans-serif;"><span style="padding:2px 6px;border-radius:4px;background:#f1f5f9;font-size:11px;">${p.status || ''}</span></td>
              <td style="padding:8px;border:1px solid #e2e8f0;font-family:sans-serif;">${p.shipments?.shipment_code || '-'}</td>
              <td style="padding:8px;border:1px solid #e2e8f0;font-family:sans-serif;">${p.created_at ? new Date(p.created_at).toLocaleDateString('pt-BR') : '-'}</td>
            </tr>
          `).join('') || '<tr><td colspan="5" style="padding:15px;text-align:center;color:#64748b;font-family:sans-serif;">Nenhuma embalagem pendente encontrada.</td></tr>'}
        </tbody>
      </table>
    `;
  }
  if (type === 'executive_summary') {
    const summary = data as any;
    const occurrences = summary.activeOccurrences as any[];
    const occurrenceRows = occurrences.map(o => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;font-family:sans-serif;font-weight:bold;">${o.cell}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;font-family:sans-serif;">${o.reason}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${o.downtime} min</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;font-size:12px;color:#64748b;font-family:sans-serif;">${o.notes || ''}</td>
      </tr>
    `).join('');
    return `
      <div style="background:#f8fafc; border: 1px solid #e2e8f0; padding:15px; border-radius:6px; margin-bottom:20px; font-family:sans-serif;">
        <p style="margin:0 0 6px 0; font-size:14px; font-weight:bold; color:#0f172a;">Lotes em Atraso Ativos</p>
        <p style="margin:0; font-size:24px; font-weight:bold; color:#dc2626;">${summary.delayedCount}</p>
      </div>
      <h3 style="font-family:sans-serif;font-size:14px;color:#0f172a;">Ocorrências Ativas (Em Aberto)</h3>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;">
        <thead>
          <tr style="background:#0f172a;color:#fff;">
            <th style="padding:6px 10px;text-align:left;">Célula</th>
            <th style="padding:6px 10px;text-align:left;">Motivo</th>
            <th style="padding:6px 10px;text-align:right;">Parada</th>
            <th style="padding:6px 10px;text-align:left;">Notas</th>
          </tr>
        </thead>
        <tbody>
          ${occurrenceRows || '<tr><td colspan="4" style="padding:15px;text-align:center;color:#64748b;font-family:sans-serif;">Nenhuma ocorrência em aberto no momento.</td></tr>'}
        </tbody>
      </table>
    `;
  }
  return `
    <p style="font-family:sans-serif;font-size:14px;color:#334155;">
      Este e-mail contém o relatório de <b>${REPORT_TYPE_LABELS[type] || type}</b> solicitado para o período.
    </p>
    <p style="font-family:sans-serif;font-size:13px;color:#64748b;">
      Caso existam anexos no formato CSV/Excel, verifique a seção de anexos da sua mensagem.
    </p>
  `;
}
function wrapEmailTemplate(schedule: any, bodyContent: string) {
  return `
    <div style="font-family:sans-serif;color:#1e293b;max-width:680px;margin:0 auto;border:1px solid #dbe3ea;border-radius:14px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,0.08);">
      <div style="background:#00522d;color:#ffffff;padding:18px 22px;display:flex;align-items:center;gap:14px;">
        <img src="${LEO_LOGO_URL}" alt="Leo Madeiras" width="54" height="54" style="border-radius:12px;border:2px solid #ffffff;display:block;" />
        <div>
          <h2 style="margin:0;font-size:20px;letter-spacing:0.2px;color:#ffed00;">Leo Madeiras</h2>
          <p style="margin:4px 0 0 0;font-size:13px;color:#ffffff;">AC.Prod - Relatórios Industriais</p>
        </div>
      </div>
      <div style="padding:24px;background:#ffffff;">
        <h2 style="margin-top:0;font-size:18px;color:#0f172a;">${schedule.name}</h2>
        <p style="font-size:12px;color:#64748b;margin-bottom:20px;">Frequência: ${schedule.frequency} • Gerado em: ${new Date().toLocaleString('pt-BR')}</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin-bottom:20px;"/>
        ${bodyContent}
      </div>
      <div style="background:#f8fafc;padding:15px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;">
        E-mail automático gerado pelo sistema AC.Prod MES. Favor não responder diretamente a este remetente.
      </div>
    </div>
  `;
}
function safeFilename(value: string) {
  return (value || 'relatorio')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'relatorio';
}
function csvCell(value: any) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}
function brandedAttachmentHeader(reportType: string, schedule: any) {
  return [
    ['Logomarca', 'Leo Madeiras'],
    ['Sistema', 'AC.Prod - Relatorios Industriais'],
    ['Relatorio', REPORT_TYPE_LABELS[reportType] || reportType],
    ['Agendamento', schedule?.name || ''],
    ['Gerado em', new Date().toLocaleString('pt-BR')],
    []
  ];
}
function reportTable(reportType: string, data: any) {
  if (reportType === 'daily_production' || reportType === 'shift_closure' || reportType === 'oee') {
    const entries = data as any[];
    return {
      columns: ['Celula', 'Turno', 'Data', 'Produzido', 'Meta', 'Refugo', 'ParadasMinutos'],
      rows: entries.map(e => [e.cell || '', e.shift || '', e.date || '', e.produced || 0, e.target || 0, e.scrap || 0, e.downtime || 0])
    };
  }
  if (reportType === 'traceability_pending' || reportType === 'lots_delayed' || reportType === 'packaging_pending') {
    const lots = data as any[];
    return {
      columns: ['CodigoLote', 'OrdemProducao', 'Status', 'PrazoEntrega'],
      rows: lots.map(l => [l.lot_code || '', l.production_orders?.order_code || '', l.status || '', l.delivery_date || ''])
    };
  }
  if (reportType === 'shipping_pending') {
    const packages = data as any[];
    return {
      columns: ['CodigoEmbalagem', 'Volume', 'Status', 'Remessa', 'CriadoEm'],
      rows: packages.map(p => [p.package_code || '', p.volume_number || 1, p.status || '', p.shipments?.shipment_code || '', p.created_at || ''])
    };
  }
  if (reportType === 'executive_summary') {
    const summary = data as any;
    const occurrences = summary.activeOccurrences as any[];
    return {
      columns: ['Indicador', 'Celula', 'Motivo', 'ParadaMinutos', 'Notas'],
      rows: [
        ['Lotes em atraso', '', '', summary.delayedCount || 0, ''],
        ...occurrences.map(o => ['Ocorrencia aberta', o.cell || '', o.reason || '', o.downtime || 0, o.notes || ''])
      ]
    };
  }
  return {
    columns: ['Relatorio', 'GeradoEm'],
    rows: [[reportType, new Date().toISOString()]]
  };
}
function generateReportCsv(reportType: string, data: any, schedule: any) {
  const table = reportTable(reportType, data);
  const rows = [
    ...brandedAttachmentHeader(reportType, schedule),
    table.columns,
    ...table.rows
  ];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\n');
}
function generateReportExcelHtml(reportType: string, data: any, schedule: any) {
  const table = reportTable(reportType, data);
  const headerRows = brandedAttachmentHeader(reportType, schedule).filter(row => row.length);
  const cell = (value: any) => String(value ?? '').replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] || ch));
  return `<!doctype html>
  <html>
    <head><meta charset="utf-8" /></head>
    <body>
      <table>
        <tr>
          <td colspan="${Math.max(table.columns.length, 2)}" style="background:#00522d;color:#ffed00;font-size:20px;font-weight:bold;padding:12px;">
            <img src="${LEO_LOGO_URL}" width="54" height="54" style="vertical-align:middle;margin-right:12px;" />
            Leo Madeiras
          </td>
        </tr>
        ${headerRows.map(row => `<tr><td style="font-weight:bold;background:#f8fafc;">${cell(row[0])}</td><td colspan="${Math.max(table.columns.length - 1, 1)}">${cell(row[1])}</td></tr>`).join('')}
        <tr></tr>
        <tr>${table.columns.map(col => `<th style="background:#0f172a;color:#fff;padding:6px;">${cell(col)}</th>`).join('')}</tr>
        ${table.rows.map(row => `<tr>${row.map(value => `<td style="border:1px solid #dbe3ea;padding:6px;">${cell(value)}</td>`).join('')}</tr>`).join('')}
      </table>
    </body>
  </html>`;
}
async function generateReportPdf(reportType: string, data: any, schedule: any) {
  const table = reportTable(reportType, data);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logoResp = await fetch(LEO_LOGO_URL);
  const logoBytes = new Uint8Array(await logoResp.arrayBuffer());
  const logo = await pdf.embedJpg(logoBytes);
  let page = pdf.addPage([595, 842]);
  let y = 792;
  const addPage = () => {
    page = pdf.addPage([595, 842]);
    y = 792;
  };
  page.drawRectangle({ x: 40, y: 772, width: 515, height: 48, color: rgb(0, 0.32, 0.18) });
  page.drawImage(logo, { x: 48, y: 778, width: 36, height: 36 });
  page.drawText('Leo Madeiras', { x: 96, y: 800, size: 16, font: bold, color: rgb(1, 0.93, 0) });
  page.drawText('AC.Prod - Relatorios Industriais', { x: 96, y: 784, size: 10, font, color: rgb(1, 1, 1) });
  y = 742;
  page.drawText(REPORT_TYPE_LABELS[reportType] || reportType, { x: 40, y, size: 16, font: bold, color: rgb(0.06, 0.09, 0.16) });
  y -= 18;
  page.drawText(`Agendamento: ${schedule?.name || ''}`, { x: 40, y, size: 9, font, color: rgb(0.39, 0.45, 0.55) });
  y -= 14;
  page.drawText(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, { x: 40, y, size: 9, font, color: rgb(0.39, 0.45, 0.55) });
  y -= 24;
  const colCount = table.columns.length || 1;
  const colW = 515 / colCount;
  table.columns.forEach((col, i) => {
    page.drawRectangle({ x: 40 + i * colW, y: y - 5, width: colW, height: 16, color: rgb(0.06, 0.09, 0.16) });
    page.drawText(String(col).slice(0, 16), { x: 44 + i * colW, y, size: 7, font: bold, color: rgb(1, 1, 1) });
  });
  y -= 18;
  table.rows.slice(0, 120).forEach((row) => {
    if (y < 50) {
      addPage();
    }
    row.forEach((value, i) => {
      page.drawText(String(value ?? '').slice(0, 24), { x: 44 + i * colW, y, size: 7, font, color: rgb(0.12, 0.16, 0.22) });
    });
    y -= 13;
  });
  if (table.rows.length > 120) {
    if (y < 50) addPage();
    page.drawText(`Exibidas 120 de ${table.rows.length} linhas. Use CSV/Excel para a base completa.`, { x: 40, y, size: 8, font, color: rgb(0.39, 0.45, 0.55) });
  }
  return pdf.save();
}
async function sendEmail(opts: {
  recipients: string[];
  subject: string;
  html: string;
  attachments?: any[];
}) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const smtpUser = Deno.env.get('SMTP_USER');
  const smtpPass = Deno.env.get('SMTP_PASS');
  if (resendKey) {
    console.log(`Usando Resend API para envio para ${opts.recipients.join(', ')}`);
    try {
      const res = await fetch('https:
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'AC.Prod MES <alertas@acprod.com.br>',
          to: opts.recipients,
          subject: opts.subject,
          html: opts.html,
          attachments: opts.attachments || []
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      return { success: true };
    } catch (err: any) {
      console.error('Erro no envio via Resend:', err);
      if (smtpUser && smtpPass) {
        return sendViaSmtp(smtpUser, smtpPass, opts);
      }
      return { success: false, error: err.message };
    }
  } else if (smtpUser && smtpPass) {
    return sendViaSmtp(smtpUser, smtpPass, opts);
  } else {
    return { success: false, error: 'Nenhum provedor de e-mail configurado (RESEND_API_KEY ou SMTP_USER/SMTP_PASS ausentes).' };
  }
}
async function sendViaSmtp(user: string, pass: string, opts: any) {
  console.log(`Usando SMTP Gmail para envio para ${opts.recipients.join(', ')}`);
  try {
    const nodemailer = (await import("npm:nodemailer@6.9.9")).default;
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass }
    });
    const mailOptions: any = {
      from: `"AC.Prod MES" <${user}>`,
      to: opts.recipients,
      subject: opts.subject,
      html: opts.html,
      text: "Use um cliente de e-mail com suporte a HTML para visualizar este relatório."
    };
    if (opts.attachments && opts.attachments.length > 0) {
      mailOptions.attachments = opts.attachments.map((att: any) => ({
        filename: att.filename,
        content: Buffer.from(att.content, 'base64'),
        contentType: att.contentType
      }));
    }
    await transporter.sendMail(mailOptions);
    return { success: true };
  } catch (err: any) {
    console.error('Erro no envio via SMTP:', err);
    return { success: false, error: err.message };
  }
}
function calculateNextRun(frequency: string, timeLocal: string) {
  const [hours, minutes] = timeLocal.split(':').map(Number);
  const now = new Date();
  const getBrasiliaDate = (date: Date) => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false
    });
    const parts = formatter.formatToParts(date);
    const getPart = (type: string) => Number(parts.find(p => p.type === type)?.value);
    return new Date(Date.UTC(getPart("year"), getPart("month") - 1, getPart("day"), getPart("hour"), getPart("minute"), getPart("second")));
  };
  const brDate = getBrasiliaDate(now);
  let targetLocal = new Date(brDate);
  targetLocal.setUTCHours(hours, minutes, 0, 0);
  const isPast = targetLocal.getTime() <= brDate.getTime();
  if (isPast) {
    if (frequency === 'daily') {
      targetLocal.setUTCDate(targetLocal.getUTCDate() + 1);
    } else if (frequency === 'workdays') {
      targetLocal.setUTCDate(targetLocal.getUTCDate() + 1);
      while (targetLocal.getUTCDay() === 0 || targetLocal.getUTCDay() === 6) {
        targetLocal.setUTCDate(targetLocal.getUTCDate() + 1);
      }
    } else if (frequency === 'weekly') {
      targetLocal.setUTCDate(targetLocal.getUTCDate() + 7);
    } else if (frequency === 'monthly') {
      targetLocal.setUTCMonth(targetLocal.getUTCMonth() + 1);
    }
  } else {
    if (frequency === 'workdays') {
      while (targetLocal.getUTCDay() === 0 || targetLocal.getUTCDay() === 6) {
        targetLocal.setUTCDate(targetLocal.getUTCDate() + 1);
      }
    }
  }
  const offset = brDate.getTime() - now.getTime();
  const targetUTC = new Date(targetLocal.getTime() - offset);
  return targetUTC;
}
