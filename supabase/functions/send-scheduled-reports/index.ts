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

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char));
}

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
        await supabase
          .from('report_schedules')
          .update({
            last_attempt_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', schedule.id);

        // 1. Resolver todos os e-mails e contatos destinatários
        const recipientsList: Array<{ email: string; name: string; profile_id?: string }> = [];

        // A. Carregar perfis individuais (recipient_profile_ids)
        if (schedule.recipient_profile_ids && schedule.recipient_profile_ids.length > 0) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, name, email, report_email, role, report_delivery_enabled')
            .in('id', schedule.recipient_profile_ids)
            .eq('active', true);

          if (profiles) {
            profiles
              .filter(p => ['admin', 'manager', 'supervisor'].includes(p.role) || p.report_delivery_enabled === true)
              .forEach(p => {
              const deliveryEmail = p.report_email || p.email;
              if (deliveryEmail) {
                recipientsList.push({ email: deliveryEmail.trim().toLowerCase(), name: p.name || deliveryEmail, profile_id: p.id });
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
                  .select('id, name, email, report_email, role, report_delivery_enabled')
                  .eq('id', m.profile_id)
                  .eq('active', true)
                  .single();
                const deliveryEmail = p?.report_email || p?.email;
                if (p && deliveryEmail && (['admin', 'manager', 'supervisor'].includes(p.role) || p.report_delivery_enabled === true)) {
                  recipientsList.push({ email: deliveryEmail.trim().toLowerCase(), name: p.name || deliveryEmail, profile_id: p.id });
                }
              }
            }
          }
        }

        // C. Endereços extras configurados explicitamente no agendamento
        if (Array.isArray(schedule.extra_emails)) {
          schedule.extra_emails
            .map((email: unknown) => String(email || '').trim().toLowerCase())
            .filter((email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            .forEach((email: string) => {
              recipientsList.push({ email, name: email });
            });
        }

        // Remover duplicados por e-mail
        const uniqueRecipientsMap = new Map<string, typeof recipientsList[0]>();
        recipientsList.forEach(r => uniqueRecipientsMap.set(r.email, r));
        const finalRecipients = [...uniqueRecipientsMap.values()];

        if (finalRecipients.length === 0) {
          console.log(`[MES Scheduler] Nenhum destinatário resolvido para ${schedule.name}. Ignorando.`);
          const errorMessage = 'Nenhum destinatário válido resolvido.';
          const nextRun = calculateNextRun(schedule.frequency, schedule.time_local);
          await supabase
            .from('report_schedule_runs')
            .update({ status: 'skipped', last_error: errorMessage, finished_at: new Date().toISOString() })
            .eq('id', runId);
          if (!schedule.test_mode) {
            await supabase
              .from('report_schedules')
              .update({
                next_run_at: nextRun.toISOString(),
                last_failure_at: new Date().toISOString(),
                last_error: errorMessage,
                consecutive_failures: (schedule.consecutive_failures || 0) + 1,
                updated_at: new Date().toISOString(),
              })
              .eq('id', schedule.id);
          }
          results.push({
            scheduleId: schedule.id,
            name: schedule.name,
            status: 'skipped',
            success: false,
            error: errorMessage,
          });
          continue;
        }

        // 2. Buscar dados dos relatórios configurados
        const reportTypes = schedule.report_types || [schedule.report_type || 'daily_production'];
        let combinedHtmlBody = '';
        const attachments: any[] = [];
        const attachmentWarnings: string[] = [];

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
                ${escapeHtml(REPORT_TYPE_LABELS[type] || type)}
              </h2>
              ${fragmentHtml}
            </div>
          `;

          // Gerar anexos
          if (['pdf', 'xlsx', 'csv'].includes(schedule.format)) {
            const filenameBase = `${safeFilename(schedule.name)}_${type}`;
            try {
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
            } catch (attachmentError: any) {
              const warning = `${REPORT_TYPE_LABELS[type] || type}: anexo ${schedule.format} indisponível (${attachmentError?.message || 'erro de geração'})`;
              attachmentWarnings.push(warning);
              console.error(`[MES Scheduler] ${warning}`);
            }
          }
        }

        if (attachmentWarnings.length) {
          combinedHtmlBody += `
            <div style="padding:12px;border:1px solid #f59e0b;background:#fffbeb;color:#92400e;border-radius:8px;font-family:sans-serif;">
              O relatório foi entregue no corpo do e-mail. Alguns anexos não puderam ser gerados nesta execução:
              ${attachmentWarnings.map((warning) => `<div>• ${escapeHtml(warning)}</div>`).join('')}
            </div>
          `;
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
            totalFailed++;
            continue;
          }

          // Enviar e-mail individual
          const sent = await sendEmail({
            recipients: [rec.email],
            subject: `[Leo Flow] ${schedule.name}`,
            html: htmlContent,
            attachments
          });

          // Atualizar status individual
          await supabase
            .from('report_deliveries')
            .update({
              status: sent.success ? 'sent' : 'failed',
              delivery_state: sent.success ? 'provider_accepted' : 'failed',
              provider: sent.provider || null,
              provider_message_id: sent.providerMessageId || null,
              provider_response: sent.providerResponse || null,
              provider_accepted: sent.accepted || [],
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
        const runStatus = totalSuccess === 0
          ? 'failed'
          : (totalFailed > 0 || attachmentWarnings.length > 0 ? 'partial' : 'sent');
        const runError = [
          totalFailed > 0 ? `${totalFailed} envios falharam.` : '',
          ...attachmentWarnings,
        ].filter(Boolean).join(' ');
        await supabase
          .from('report_schedule_runs')
          .update({
            status: runStatus,
            finished_at: new Date().toISOString(),
            last_error: runError || null
          })
          .eq('id', runId);

        // 5. Atualizar o próprio schedule (next_run_at)
        if (!schedule.test_mode) {
          const nextRun = calculateNextRun(schedule.frequency, schedule.time_local);
          await supabase
            .from('report_schedules')
            .update({
              last_sent_at: totalSuccess > 0 ? new Date().toISOString() : schedule.last_sent_at,
              next_run_at: nextRun.toISOString(),
              last_success_at: totalSuccess > 0 ? new Date().toISOString() : schedule.last_success_at,
              last_failure_at: runStatus === 'failed' ? new Date().toISOString() : schedule.last_failure_at,
              consecutive_failures: runStatus === 'failed' ? (schedule.consecutive_failures || 0) + 1 : 0,
              last_error: runError || null,
              paused_reason: null,
              updated_at: new Date().toISOString()
            })
            .eq('id', schedule.id);
        }

        const { data: runDeliveries } = await supabase
          .from('report_deliveries')
          .select('recipient_email_snapshot,delivery_state,provider,provider_message_id')
          .eq('run_id', runId);
        results.push({
          scheduleId: schedule.id,
          name: schedule.name,
          status: runStatus,
          success: totalSuccess > 0,
          accepted: totalSuccess,
          failed: totalFailed,
          deliveries: runDeliveries || [],
          providerMessageId: runDeliveries?.[0]?.provider_message_id || null,
        });

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

        if (!schedule.test_mode) {
          const nextRun = calculateNextRun(schedule.frequency, schedule.time_local);
          await supabase
            .from('report_schedules')
            .update({
              next_run_at: nextRun.toISOString(),
              last_failure_at: new Date().toISOString(),
              last_error: err.message,
              consecutive_failures: (schedule.consecutive_failures || 0) + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', schedule.id);
        }

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
