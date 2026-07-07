/**
 * AC.Prod MES — Service de Alertas Operacionais Industriais
 * 
 * Gerencia o monitoramento e a resolução de alertas industriais na fábrica (peça parada, sumida, retrabalho atrasado, etc.).
 * Grava na tabela public.alert_logs com chaves únicas ('signature') para evitar duplicação.
 */

import { supabase } from '@/lib/supabaseClient';

export const ACTIVE_ALERTS_QUERY_KEY = ['unresolved-alerts-list'];

const STAGE_LIMITS_HOURS = {
  'Corte': 4,
  'Bordo': 8,
  'Usinagem': 8,
  'Marcenaria': 12,
  'Embalagem': 8,
  'Expedição': 24
};

/**
 * Executa a verificação completa e gera os alertas operacionais.
 * Pode ser chamado via cron, pelo painel gestor ou disparado por ações de PCP.
 */
export async function runOperationalAlertDiagnostics() {
  const alertsTriggered = [];
  const activeSignatures = new Set();

  try {
    const now = new Date();

    // ─────────────────────────────────────────────────────────────
    // 1. DIAGNÓSTICO: Peça parada tempo demais & Peça perdida
    // ─────────────────────────────────────────────────────────────
    const { data: pieces, error: piecesError } = await supabase
      .from('production_pieces')
      .select('id, piece_uid, piece_name, current_stage, status, updated_at, lot_id, production_order_id')
      .not('status', 'in', '("completed","cancelled","shipped")');
    if (piecesError && !isOptionalSchemaError(piecesError)) throw piecesError;

    if (pieces) {
      pieces.forEach(p => {
        const limitHours = STAGE_LIMITS_HOURS[p.current_stage] || 12;
        const timeSpentMs = now - new Date(p.updated_at);
        const timeSpentHours = timeSpentMs / (1000 * 60 * 60);

        if (timeSpentHours > limitHours && p.current_stage !== 'created') {
          // Alerta: Peça Parada
          const signature = `stopped_piece:${p.id}:${p.current_stage}`;
          activeSignatures.add(signature);
          alertsTriggered.push({
            signature,
            cell: p.current_stage,
            message: `Peça ${p.piece_name} (${p.piece_uid}) está retida na etapa ${p.current_stage} há mais de ${Math.round(timeSpentHours)}h (Limite: ${limitHours}h).`,
            severity: 'warning',
            metadata: { piece_id: p.id, lot_id: p.lot_id, current_stage: p.current_stage, hours: timeSpentHours }
          });
        }
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 2. DIAGNÓSTICO: Lote Atrasado (Data de entrega vencida)
    // ─────────────────────────────────────────────────────────────
    const { data: lots, error: lotsError } = await supabase
      .from('production_lots')
      .select(`
        id, lot_code, status, delivery_date, production_orders:production_orders!production_order_id ( delivery_date )
      `)
      .not('status', 'in', '("shipped","cancelled")');
    if (lotsError && !isOptionalSchemaError(lotsError)) throw lotsError;

    if (lots) {
      lots.forEach(l => {
        const deliveryDateStr = l.delivery_date || l.production_orders?.delivery_date;
        if (deliveryDateStr) {
          const delivery = new Date(deliveryDateStr);
          if (delivery < now) {
            // Alerta: Lote Atrasado
            const signature = `late_lot:${l.id}:${deliveryDateStr}`;
            activeSignatures.add(signature);
            alertsTriggered.push({
              signature,
              cell: 'PCP',
              message: `Lote ${l.lot_code} está em atraso. Prazo acordado de entrega vencido em: ${new Date(deliveryDateStr).toLocaleDateString('pt-BR')}.`,
              severity: 'critical',
              metadata: { lot_id: l.id, delivery_date: deliveryDateStr }
            });
          }
        }

        // Lote bloqueado
        if (l.status === 'blocked') {
          const signature = `blocked_lot:${l.id}`;
          activeSignatures.add(signature);
          alertsTriggered.push({
            signature,
            cell: 'Fábrica',
            message: `O Lote ${l.lot_code} encontra-se BLOQUEADO para produção. Libere as pendências.`,
            severity: 'critical',
            metadata: { lot_id: l.id }
          });
        }
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 3. DIAGNÓSTICO: Retrabalho Pendente
    // ─────────────────────────────────────────────────────────────
    const { data: reworkOrders, error: reworkError } = await supabase
      .from('rework_orders')
      .select('id, original_piece_id, replacement_piece_id, stage_at_damage, rework_reasons ( description )')
      .eq('status', 'pending');
    if (reworkError && !isOptionalSchemaError(reworkError)) throw reworkError;

    if (reworkOrders) {
      reworkOrders.forEach(rw => {
        const signature = `pending_rework:${rw.id}`;
        activeSignatures.add(signature);
        alertsTriggered.push({
          signature,
          cell: rw.stage_at_damage || 'Qualidade',
          message: `Ordem de retrabalho #${rw.id.substring(0, 8)} pendente. Motivo: ${rw.rework_reasons?.description || 'não informado'}.`,
          severity: 'warning',
          metadata: { rework_order_id: rw.id, piece_id: rw.original_piece_id }
        });
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 4. DIAGNÓSTICO: Embalagem Incompleta (Lote pronto há mais de 12h mas sem volumes fechados)
    // ─────────────────────────────────────────────────────────────
    const { data: packagingLots, error: packagingError } = await supabase
      .from('production_lots')
      .select('id, lot_code, status, updated_at')
      .eq('status', 'waiting_packaging');
    if (packagingError && !isOptionalSchemaError(packagingError)) throw packagingError;

    if (packagingLots) {
      packagingLots.forEach(l => {
        const timeSinceProductionMs = now - new Date(l.updated_at);
        const timeSinceProductionHours = timeSinceProductionMs / (1000 * 60 * 60);

        if (timeSinceProductionHours > 12) {
          const signature = `incomplete_package:${l.id}`;
          activeSignatures.add(signature);
          alertsTriggered.push({
            signature,
            cell: 'Embalagem',
            message: `Lote ${l.lot_code} aguarda embalagem há mais de ${Math.round(timeSinceProductionHours)}h após fim da usinagem/marcenaria.`,
            severity: 'warning',
            metadata: { lot_id: l.id, hours: timeSinceProductionHours }
          });
        }
      });
    }

    // ─────────────────────────────────────────────────────────────
    // GRAVAR / RESOLVER NO SUPABASE
    // ─────────────────────────────────────────────────────────────
    
    // Inserir/Atualizar alertas ativos. O diagnóstico só deve prometer
    // alertas na tela depois de confirmar que o Supabase gravou os registros.
    if (alertsTriggered.length > 0) {
      const { error: upsertError } = await supabase
        .from('alert_logs')
        .upsert(alertsTriggered.map((alert) => ({
          signature: alert.signature,
          cell: alert.cell,
          message: alert.message,
          severity: alert.severity,
          resolved: false,
          metadata: alert.metadata,
          triggered_at: now.toISOString(),
          date: now.toISOString().split('T')[0]
        })), { onConflict: 'signature' });
      if (upsertError) throw upsertError;
    }

    // Resolver automaticamente os alertas que deixaram de existir
    const { data: unresolvedAlerts, error: unresolvedError } = await supabase
      .from('alert_logs')
      .select('id, signature')
      .or('resolved.is.false,resolved.is.null');
    if (unresolvedError) throw unresolvedError;

    if (unresolvedAlerts) {
      for (const alert of unresolvedAlerts) {
        if (!alert.signature) continue;
        // Se a assinatura não está na lista de alertas diagnosticados hoje, significa que o problema foi corrigido!
        if (!activeSignatures.has(alert.signature)) {
          const { error: resolveError } = await supabase
            .from('alert_logs')
            .update({
              resolved: true,
              resolved_at: now.toISOString(),
              message: `[RESOLVIDO] ${alert.signature}`
            })
            .eq('id', alert.id);
          if (resolveError) throw resolveError;
        }
      }
    }

    const activeAlerts = await getActiveAlerts();

    return {
      success: true,
      alertsTriggeredCount: alertsTriggered.length,
      activeAlertsCount: activeAlerts.length,
      activeAlerts,
    };

  } catch (error) {
    console.error('Falha ao diagnosticar e disparar alertas operacionais:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Retorna todos os alertas operacionais não resolvidos ativos.
 */
export async function getActiveAlerts() {
  const { data, error } = await supabase
    .from('alert_logs')
    .select('*')
    .or('resolved.is.false,resolved.is.null')
    .order('triggered_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

function isOptionalSchemaError(error) {
  return /schema cache|does not exist|relation .* does not exist|column .* does not exist/i.test(error?.message || '');
}

/**
 * Força a resolução manual de um alerta.
 * 
 * @param {string} alertId - UUID do alerta
 */
export async function resolveAlertManually(alertId) {
  if (!alertId) throw new Error('Alerta ID é obrigatório.');

  const userId = (await supabase.auth.getUser()).data.user?.id;

  const { data, error } = await supabase
    .from('alert_logs')
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by: userId
    })
    .eq('id', alertId)
    .select()
    .single();

  if (error) throw error;
  return data;
}
