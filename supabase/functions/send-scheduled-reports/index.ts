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

    if (scheduleId) {
      const authorization = req.headers.get('Authorization') || '';
      const token = authorization.replace(/^Bearer\s+/i, '');
      if (!token) throw new Error('Autenticação necessária para executar um relatório manual.');

      const { data: authData, error: authError } = await supabase.auth.getUser(token);
      if (authError || !authData.user) throw new Error('Sessão inválida ou expirada.');

      const { data: profile } = await supabase
        .from('profiles')
        .select('role, active, permissions')
        .eq('id', authData.user.id)
        .maybeSingle();

      const canSend = profile?.active !== false && (
        ['admin', 'manager'].includes(profile?.role)
        || profile?.permissions?.send_reports === true
        || profile?.permissions?.schedule_reports === true
        || profile?.permissions?.manage_automations === true
      );
      if (!canSend) throw new Error('Sem permissão para executar relatórios por e-mail.');
    } else {
      const cronSecret = req.headers.get('x-cron-secret') || '';
      const { data: validCronSecret, error: secretError } = await supabase
        .rpc('verify_report_cron_secret', { p_secret: cronSecret });
      if (secretError || validCronSecret !== true) {
        throw new Error('Chamada de agendamento não autorizada.');
      }
    }

    const lockToken = crypto.randomUUID();
    const results = [];

    let schedulesToProcess: any[] = [];

    if (scheduleId) {
      // ─── CASO 1: EXECUÇÃO INDIVIDUAL (MANUAL/TESTE/IA) ──────────────────────
      const { data: schedule, error: fetchError } = await supabase
        .from('report_schedules')
        .select('*')
        .eq('id', scheduleId)
        .single();
      
      if (fetchError || !schedule) {
        throw new Error(fetchError?.message || 'Agendamento não encontrado.');
      }

      // Criar a run no banco
      const runKey = `manual:${schedule.id}:${new Date().getTime()}`;
      const { data: run, error: runError } = await supabase
        .from('report_schedule_runs')
        .insert({
          schedule_id: schedule.id,
          trigger_source: test ? 'test' : 'manual',
          scheduled_for: new Date().toISOString(),
          status: 'processing',
          idempotency_key: runKey,
          started_at: new Date().toISOString()
        })
        .select()
        .single();

      if (runError) throw runError;

      schedulesToProcess.push({
        ...schedule,
        run_id: run.id,
        test_mode: !!test
      });
    } else {
      // ─── CASO 2: EXECUÇÃO CONCORRENTE VIA CRON (claim_due_report_schedules) ──
      const { data: claimedSchedules, error: claimError } = await supabase
        .rpc('claim_due_report_schedules', {
          p_lock_token: lockToken
        });

      if (claimError) throw claimError;

      if (claimedSchedules && claimedSchedules.length > 0) {
        for (const cs of claimedSchedules) {
          // Carregar detalhes completos do schedule
          const { data: schedule } = await supabase
            .from('report_schedules')
            .select('*')
            .eq('id', cs.schedule_id)
            .single();

          if (schedule) {
            schedulesToProcess.push({
              ...schedule,
              run_id: cs.run_id,
              test_mode: false
            });
          }
        }
      }
    }

    // Processar os agendamentos selecionados
    for (const schedule of schedulesToProcess) {
      const runId = schedule.run_id;
      let totalSuccess = 0;
      let totalFailed = 0;

      try {
        console.log(`[MES Scheduler] Iniciando processamento: ${schedule.name} (Run ID: ${runId})`);

        // 1. Resolver todos os e-mails e contatos destinatários
        const recipientsList: Array<{ email: string; name: string; profile_id?: string }> = [];

        // A. Carregar perfis individuais (recipient_profile_ids)
        if (schedule.recipient_profile_ids && schedule.recipient_profile_ids.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, name, email, role, report_delivery_enabled')
            .in('id', schedule.recipient_profile_ids)
            .eq('active', true);

          if (profiles) {
            profiles
              .filter(p => ['admin', 'manager', 'supervisor'].includes(p.role) || p.report_delivery_enabled === true)
              .forEach(p => {
              if (p.email) {
                recipientsList.push({ email: p.email.trim().toLowerCase(), name: p.name || p.email, profile_id: p.id });
              }
              });
          }
        }

        // B. Carregar perfis e contatos dos grupos (recipient_group_ids)
        if (schedule.recipient_group_ids && schedule.recipient_group_ids.length > 0) {
          const { data: groupMembers } = await supabase
            .from('email_recipient_group_members')
            .select('profile_id')
            .in('group_id', schedule.recipient_group_ids);

          if (groupMembers) {
            for (const m of groupMembers) {
              if (m.profile_id) {
                const { data: p } = await supabase
                  .from('profiles')
                  .select('id, name, email, role, report_delivery_enabled')
                  .eq('id', m.profile_id)
                  .eq('active', true)
                  .single();
                if (p && p.email && (['admin', 'manager', 'supervisor'].includes(p.role) || p.report_delivery_enabled === true)) {
                  recipientsList.push({ email: p.email.trim().toLowerCase(), name: p.name || p.email, profile_id: p.id });
                }
              }
            }
          }
        }

        // Remover duplicados por e-mail
        const uniqueRecipientsMap = new Map<string, typeof recipientsList[0]>();
        recipientsList.forEach(r => uniqueRecipientsMap.set(r.email, r));
        const finalRecipients = [...uniqueRecipientsMap.values()];

        if (finalRecipients.length === 0) {
          console.log(`[MES Scheduler] Nenhum destinatário resolvido para ${schedule.name}. Ignorando.`);
          await supabase
            .from('report_schedule_runs')
            .update({ status: 'skipped', last_error: 'Nenhum destinatário válido resolvido.', finished_at: new Date().toISOString() })
            .eq('id', runId);
          continue;
        }

        // 2. Buscar dados dos relatórios configurados
        const reportTypes = schedule.report_types || [schedule.report_type || 'daily_production'];
        let combinedHtmlBody = '';
        const attachments: any[] = [];

        // Carregar células se OEE for selecionado
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

          // Gerar anexos
          if (['pdf', 'xlsx', 'csv'].includes(schedule.format)) {
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
            } else if (schedule.format === 'csv') {
              const csvContent = generateReportCsv(type, reportData, schedule);
              attachments.push({
                filename: `${filenameBase}.csv`,
                content: Buffer.from(csvContent, 'utf8').toString('base64'),
                contentType: 'text/csv'
              });
            }
          }
        }

        // Template de e-mail completo
        const htmlContent = wrapEmailTemplate(schedule, combinedHtmlBody);

        // 3. Enviar e-mails individualmente e registrar na tabela report_deliveries
        for (const rec of finalRecipients) {
          // Criar delivery inicial como queued
          const { data: delivery, error: delError } = await supabase
            .from('report_deliveries')
            .insert({
              run_id: runId,
              schedule_id: schedule.id,
              profile_id: rec.profile_id || null,
              recipient_name_snapshot: rec.name,
              recipient_email_snapshot: rec.email,
              recipient_email_normalized: rec.email,
              status: 'queued'
            })
            .select()
            .single();

          if (delError) {
            console.error(`Erro ao criar registro de delivery para ${rec.email}:`, delError);
            continue;
          }

          // Enviar e-mail individual
          const sent = await sendEmail({
            recipients: [rec.email],
            subject: `[AC.Prod] ${schedule.name}`,
            html: htmlContent,
            attachments
          });

          // Atualizar status individual
          await supabase
            .from('report_deliveries')
            .update({
              status: sent.success ? 'sent' : 'failed',
              error_message: sent.error || null,
              sent_at: sent.success ? new Date().toISOString() : null,
              attempt_count: 1
            })
            .eq('id', delivery.id);

          if (sent.success) {
            totalSuccess++;
          } else {
            totalFailed++;
          }
        }

        // 4. Atualizar o status da Run
        const runStatus = totalFailed === 0 ? 'sent' : totalSuccess === 0 ? 'failed' : 'partial';
        await supabase
          .from('report_schedule_runs')
          .update({
            status: runStatus,
            finished_at: new Date().toISOString(),
            last_error: totalFailed > 0 ? `${totalFailed} envios falharam.` : null
          })
          .eq('id', runId);

        // 5. Atualizar o próprio schedule (next_run_at)
        if (!schedule.test_mode) {
          const nextRun = calculateNextRun(schedule.frequency, schedule.time_local);
          await supabase
            .from('report_schedules')
            .update({
              last_sent_at: new Date().toISOString(),
              next_run_at: nextRun.toISOString(),
              last_success_at: runStatus === 'sent' ? new Date().toISOString() : schedule.last_success_at,
              last_failure_at: runStatus === 'failed' ? new Date().toISOString() : schedule.last_failure_at,
              consecutive_failures: runStatus === 'failed' ? (schedule.consecutive_failures || 0) + 1 : 0,
              updated_at: new Date().toISOString()
            })
            .eq('id', schedule.id);
        }

        results.push({ scheduleId: schedule.id, name: schedule.name, status: runStatus });

      } catch (err: any) {
        console.error(`Erro crítico no agendamento ${schedule.id}:`, err);
        await supabase
          .from('report_schedule_runs')
          .update({
            status: 'failed',
            finished_at: new Date().toISOString(),
            last_error: err.message
          })
          .eq('id', runId);

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
