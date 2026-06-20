import { Buffer } from "node:buffer";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";


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

const LEO_LOGO_BASE64 = "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";

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
      // Processa um agendamento específico (manual ou teste)
      const { data, error } = await supabase
        .from('report_schedules')
        .select('*')
        .eq('id', scheduleId)
        .single();
      
      if (error) throw error;
      if (data) schedulesToProcess.push(data);
    } else {
      // Processa agendamentos periódicos vencidos
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
        
        // 1. Obter e-mails dos destinatários cadastrados (recipient_profile_ids)
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

        // Adicionar e-mails extras
        if (schedule.extra_emails && schedule.extra_emails.length > 0) {
          schedule.extra_emails.forEach((email: string) => {
            if (email && email.includes('@')) {
              recipientEmails.push(email);
            }
          });
        }

        // Remover duplicados
        const recipients = [...new Set(recipientEmails)];

        if (recipients.length === 0) {
          console.log(`Nenhum destinatário encontrado para o agendamento: ${schedule.name}`);
          continue;
        }

        // 2. Determinar os tipos de relatórios a processar
        const reportTypes = (schedule.report_types && schedule.report_types.length > 0)
          ? schedule.report_types
          : (schedule.report_type ? [schedule.report_type] : []);

        if (reportTypes.length === 0) {
          console.log(`Nenhum tipo de relatório configurado para o agendamento: ${schedule.name}`);
          continue;
        }

        let combinedHtmlBody = '';
        const attachments: any[] = [];

        // Buscar dados de células se OEE estiver na lista (necessário para tempo planejado)
        let cellsData: any[] = [];
        if (reportTypes.includes('oee')) {
          const { data: cells } = await supabase.from('cells').select('*');
          cellsData = cells || [];
        }

        // Processar cada tipo
        for (const type of reportTypes) {
          const reportData = await fetchReportDataForType(supabase, type, schedule);
          
          // Renderizar fragmento do HTML
          const fragmentHtml = renderReportFragmentHtml(type, reportData, cellsData);
          combinedHtmlBody += `
            <div style="margin-bottom: 40px; border-bottom: 1px solid #f1f5f9; padding-bottom: 25px;">
              <h2 style="color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 16px; font-family:sans-serif; font-size: 16px;">
                ${REPORT_TYPE_LABELS[type] || type}
              </h2>
              ${fragmentHtml}
            </div>
          `;

          // Gerar anexos conforme o formato
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

        // 3. Renderizar HTML final completo
        const htmlContent = wrapEmailTemplate(schedule, combinedHtmlBody);

        // 5. Enviar e-mail (Resend ou SMTP)
        const sent = await sendEmail({
          recipients,
          subject: `[AC.Prod] ${schedule.name}`,
          html: htmlContent,
          attachments
        });

        // 6. Registrar Log de Entrega
        for (const email of recipients) {
          await supabase.from('report_delivery_logs').insert({
            report_schedule_id: schedule.id,
            recipient_email: email,
            status: sent.success ? 'sent' : 'failed',
            error_message: sent.error || null,
          });
        }

        // 7. Atualizar agendamento se não for teste
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

// Helper para buscar dados de um tipo específico
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

// Renderiza a parte de conteúdo do relatório de um tipo específico
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

// Helper para envolver os relatórios no layout principal
function wrapEmailTemplate(schedule: any, bodyContent: string) {
  return `
    <div style="font-family:sans-serif;color:#1e293b;max-width:680px;margin:0 auto;border:1px solid #dbe3ea;border-radius:14px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,0.08);">
      <div style="background:#00522d;color:#ffffff;padding:18px 22px;display:flex;align-items:center;gap:14px;">
        <img src="data:image/png;base64,${LEO_LOGO_BASE64}" alt="Leo Madeiras" width="54" height="54" style="border-radius:12px;border:2px solid #ffffff;display:block;" />
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
            <img src="data:image/png;base64,${LEO_LOGO_BASE64}" width="54" height="54" style="vertical-align:middle;margin-right:12px;" />
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
  const logo = await pdf.embedPng(Buffer.from(LEO_LOGO_BASE64, 'base64'));
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

// Helper para enviar e-mail via Resend API (se disponível) ou SMTP Gmail
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
      const res = await fetch('https://api.resend.com/emails', {
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
      // Fallback para SMTP se configurado
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

// Envio via nodemailer SMTP Gmail
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

// Calcular próxima execução com base na frequência
function calculateNextRun(frequency: string, timeLocal: string) {
  const [hours, minutes] = timeLocal.split(':').map(Number);
  const now = new Date();
  
  let target = new Date();
  target.setHours(hours, minutes, 0, 0);

  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  if (frequency === 'workdays') {
    while (target.getDay() === 0 || target.getDay() === 6) {
      target.setDate(target.getDate() + 1);
    }
  } else if (frequency === 'weekly') {
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 7);
    }
  } else if (frequency === 'monthly') {
    if (target.getTime() <= now.getTime()) {
      target.setMonth(target.getMonth() + 1);
    }
  }

  return target;
}
