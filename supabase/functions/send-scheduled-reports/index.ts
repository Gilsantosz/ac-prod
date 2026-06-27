import { Buffer } from "node:buffer";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { fetchReportDataForType } from "./reportFetcher.ts";
import { renderReportFragmentHtml, wrapEmailTemplate } from "./reportRenderer.ts";
import { generateReportPdf } from "./pdfGenerator.ts";
import { generateReportExcelHtml, generateReportCsv, safeFilename } from "./excelGenerator.ts";
import { sendEmail } from "./emailSender.ts";
import { calculateNextRun } from "./nextRun.ts";
import { REPORT_TYPE_LABELS } from "./labels.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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


