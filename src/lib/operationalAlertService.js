/**
 * AC.Prod MES — Service de Alertas Operacionais Industriais
 * 
 * Gerencia o monitoramento e a resolução de alertas industriais na fábrica (peça parada, sumida, retrabalho atrasado, etc.).
 * Grava na tabela public.alert_logs com chaves únicas ('signature') para evitar duplicação.
 */

import { supabase } from '@/lib/supabaseClient';

export const ACTIVE_ALERTS_QUERY_KEY = ['unresolved-alerts-list'];

const STAGE_CODE_TO_NAME = {
  cut: 'Corte',
  edge: 'Borda',
  drill: 'Furação',
  cnc: 'Usinagem',
  joinery: 'Marcenaria',
  separation: 'Separação',
  packaging: 'Embalagem',
  shipping: 'Expedição'
};

const STAGE_LIMITS_HOURS = {
  cut: 4,
  edge: 8,
  drill: 8,
  cnc: 8,
  joinery: 12,
  separation: 12,
  packaging: 8,
  shipping: 24,
  // Suporte a nomes em português caso estejam salvos diretamente na peça
  'Corte': 4,
  'Borda': 8,
  'Bordo': 8,
  'Furação': 8,
  'Usinagem': 8,
  'Marcenaria': 12,
  'Separação': 12,
  'Embalagem': 8,
  'Expedição': 24
};

function getStageDisplayName(stage) {
  if (!stage) return 'Geral';
  const clean = stage.trim().toLowerCase();
  if (STAGE_CODE_TO_NAME[clean]) return STAGE_CODE_TO_NAME[clean];
  const matched = Object.entries(STAGE_CODE_TO_NAME).find(([k, v]) => v.toLowerCase() === clean);
  if (matched) return matched[1];
  return stage;
}

function getStageCode(stage) {
  if (!stage) return 'general';
  const clean = stage.trim().toLowerCase();
  if (STAGE_CODE_TO_NAME[clean]) return clean;
  const matched = Object.entries(STAGE_CODE_TO_NAME).find(([k, v]) => v.toLowerCase() === clean);
  if (matched) return matched[0];
  return clean;
}

// Controle de concorrência local
let lastDiagnosticRunTime = 0;

/**
 * Executa a verificação completa e gera os alertas operacionais.
 * Centraliza o diagnóstico no banco de dados e evita storms.
 */
export async function runOperationalAlertDiagnostics() {
  const now = Date.now();
  // Evitar múltiplos diagnósticos em menos de 10 segundos
  if (now - lastDiagnosticRunTime < 10000) {
    console.log('[Operational Alert Service] Diagnóstico ignorado para evitar concorrência (limite de 10s).');
    const activeAlerts = await getActiveAlerts();
    return {
      success: true,
      skipped: true,
      activeAlertsCount: activeAlerts.length,
      activeAlerts
    };
  }
  lastDiagnosticRunTime = now;

  const alertsTriggered = [];
  const activeSignatures = new Set();
  const nowDate = new Date();

  try {
    // ─────────────────────────────────────────────────────────────
    // 1. CARREGAR DADOS DE AUXÍLIO (LOTES E BATCHES)
    // ─────────────────────────────────────────────────────────────
    const [lotsResult, batchesResult] = await Promise.all([
      supabase
        .from('production_lots')
        .select('id, lot_code, status, customer_name, progress_percent, pcp_import_batch_id, production_orders:production_orders!production_order_id ( delivery_date, customer_name )'),
      supabase
        .from('promob_import_batches')
        .select('id, general_lot_code, progress_percent')
    ]);

    if (lotsResult.error) throw lotsResult.error;
    if (batchesResult.error) throw batchesResult.error;

    const lotMap = {};
    if (lotsResult.data) {
      lotsResult.data.forEach(l => {
        lotMap[l.id] = l;
      });
    }

    const batchMap = {};
    if (batchesResult.data) {
      batchesResult.data.forEach(b => {
        batchMap[b.id] = b;
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 2. DIAGNÓSTICO: Peças Retidas / Paradas & Peças Especiais
    // ─────────────────────────────────────────────────────────────
    const { data: pieces, error: piecesError } = await supabase
      .from('production_pieces')
      .select('id, piece_uid, piece_name, current_stage, status, updated_at, lot_id, production_order_id, pcp_import_batch_id, manual_joinery, manual_joinery_reason')
      .not('status', 'in', '("completed","cancelled","shipped")');

    if (piecesError && !isOptionalSchemaError(piecesError)) throw piecesError;

    const groupedStuckPieces = {};
    const stuckPieceIds = [];

    if (pieces) {
      pieces.forEach(p => {
        const lot = lotMap[p.lot_id] || {};
        const batch = batchMap[p.pcp_import_batch_id || lot.pcp_import_batch_id] || {};
        const customerName = lot.customer_name || lot.production_orders?.customer_name || 'Desconhecido';

        // 2a. Peças especiais aguardando baixa manual na Marcenaria
        if (p.manual_joinery && p.status !== 'completed' && p.status !== 'shipped' && p.status !== 'cancelled') {
          const signature = `pending_special_piece:${p.id}`;
          activeSignatures.add(signature);
          alertsTriggered.push({
            signature,
            cell: 'Marcenaria',
            message: `Peça especial "${p.piece_name}" (${p.piece_uid}) do cliente ${customerName} aguardando baixa manual na Marcenaria.`,
            severity: 'warning',
            metadata: {
              type: 'special_piece',
              piece_id: p.id,
              piece_uid: p.piece_uid,
              piece_name: p.piece_name,
              lot_id: p.lot_id,
              lot_code: lot.lot_code || 'Avulso',
              customer_name: customerName,
              general_lot_code: batch.general_lot_code || 'N/A',
              general_lot_progress: batch.progress_percent ? Number(batch.progress_percent) : 0,
              client_lot_progress: lot.progress_percent ? Number(lot.progress_percent) : 0,
              reason: p.manual_joinery_reason || 'Pendente de acabamento'
            }
          });
        }

        // 2b. Peças retidas na etapa (atrasadas)
        const stage = p.current_stage;
        if (stage && stage !== 'created' && stage !== 'completed' && stage !== 'shipped' && stage !== 'cancelled') {
          const limitHours = STAGE_LIMITS_HOURS[stage] || 12;
          const timeSpentMs = nowDate - new Date(p.updated_at);
          const timeSpentHours = timeSpentMs / (1000 * 60 * 60);

          if (timeSpentHours > limitHours) {
            const lotId = p.lot_id || 'no-lot';
            const batchId = p.pcp_import_batch_id || lot.pcp_import_batch_id || 'no-batch';
            const groupKey = `${batchId}:${lotId}:${stage}`;

            if (!groupedStuckPieces[groupKey]) {
              groupedStuckPieces[groupKey] = {
                batchId,
                lotId,
                stage,
                pieces: [],
                minUpdatedAt: p.updated_at,
                maxTimeSpentHours: timeSpentHours,
                lastMovement: p.updated_at
              };
            }

            groupedStuckPieces[groupKey].pieces.push(p);
            stuckPieceIds.push(p.id);
            if (new Date(p.updated_at) < new Date(groupedStuckPieces[groupKey].minUpdatedAt)) {
              groupedStuckPieces[groupKey].minUpdatedAt = p.updated_at;
            }
            if (timeSpentHours > groupedStuckPieces[groupKey].maxTimeSpentHours) {
              groupedStuckPieces[groupKey].maxTimeSpentHours = timeSpentHours;
            }
            if (new Date(p.updated_at) > new Date(groupedStuckPieces[groupKey].lastMovement)) {
              groupedStuckPieces[groupKey].lastMovement = p.updated_at;
            }
          }
        }
      });
    }

    // Buscar operador e máquina das peças paradas em uma consulta única
    const readingsMap = {};
    if (stuckPieceIds.length > 0) {
      const { data: readings } = await supabase
        .from('production_stage_readings')
        .select('piece_id, operator, machine_name, created_at')
        .in('piece_id', stuckPieceIds)
        .order('created_at', { ascending: false });

      if (readings) {
        readings.forEach(r => {
          if (!readingsMap[r.piece_id]) {
            readingsMap[r.piece_id] = r;
          }
        });
      }
    }

    // Criar alertas agrupados de peças paradas por lote geral + lote do cliente + etapa
    Object.values(groupedStuckPieces).forEach(group => {
      const lot = lotMap[group.lotId] || {};
      const batch = batchMap[group.batchId] || {};
      const lotCode = lot.lot_code || 'Avulso';
      const batchCode = batch.general_lot_code || 'Avulso';
      const customerName = lot.customer_name || 'Desconhecido';
      const stageName = getStageDisplayName(group.stage);
      const count = group.pieces.length;
      const oldestDate = new Date(group.minUpdatedAt).toLocaleString('pt-BR');

      // Obter o último operador e máquina do grupo
      let lastOperator = null;
      let lastMachine = null;
      let latestMovementObj = null;

      group.pieces.forEach(p => {
        const r = readingsMap[p.id];
        if (r) {
          if (!latestMovementObj || new Date(r.created_at) > new Date(latestMovementObj.created_at)) {
            latestMovementObj = r;
          }
        }
      });

      if (latestMovementObj) {
        lastOperator = latestMovementObj.operator;
        lastMachine = latestMovementObj.machine_name;
      }

      const generalProgress = batch.progress_percent ? Number(batch.progress_percent) : 0;
      const clientProgress = lot.progress_percent ? Number(lot.progress_percent) : 0;

      const signature = `stuck_pieces_group:${group.batchId}:${group.lotId}:${group.stage}`;
      activeSignatures.add(signature);

      const msg = `Lote Geral: ${batchCode} | Lote Cliente: ${lotCode} (${customerName}) - ${count} peça(s) retida(s) em ${stageName} há mais de ${Math.round(group.maxTimeSpentHours)}h. A mais antiga desde: ${oldestDate}.`;

      alertsTriggered.push({
        signature,
        cell: stageName,
        message: msg,
        severity: 'warning',
        metadata: {
          type: 'stuck_pieces_group',
          piece_ids: group.pieces.map(p => p.id),
          piece_count: count,
          general_lot_id: group.batchId,
          general_lot_code: batchCode,
          client_lot_id: group.lotId,
          client_lot_code: lotCode,
          customer_name: customerName,
          stage: group.stage,
          stage_name: stageName,
          max_hours: group.maxTimeSpentHours,
          oldest_piece_updated_at: group.minUpdatedAt,
          last_operator: lastOperator,
          last_machine: lastMachine,
          last_movement_at: group.lastMovement,
          general_lot_progress: generalProgress,
          client_lot_progress: clientProgress
        }
      });
    });

    // ─────────────────────────────────────────────────────────────
    // 3. DIAGNÓSTICO: Lotes Bloqueados ou Atrasados
    // ─────────────────────────────────────────────────────────────
    if (lotsResult.data) {
      lotsResult.data.forEach(l => {
        const batch = batchMap[l.pcp_import_batch_id] || {};
        const customerName = l.customer_name || l.production_orders?.customer_name || 'Desconhecido';
        const deliveryDateStr = l.delivery_date || l.production_orders?.delivery_date;

        // 3a. Lote atrasado
        if (deliveryDateStr) {
          const delivery = new Date(deliveryDateStr);
          if (delivery < nowDate && l.status !== 'shipped' && l.status !== 'cancelled') {
            const signature = `late_lot:${l.id}:${deliveryDateStr}`;
            activeSignatures.add(signature);
            alertsTriggered.push({
              signature,
              cell: 'PCP',
              message: `Lote ${l.lot_code} está em atraso. Prazo acordado de entrega vencido em: ${delivery.toLocaleDateString('pt-BR')}.`,
              severity: 'critical',
              metadata: {
                type: 'late_lot',
                lot_id: l.id,
                lot_code: l.lot_code,
                delivery_date: deliveryDateStr,
                customer_name: customerName,
                general_lot_code: batch.general_lot_code || 'N/A',
                general_lot_progress: batch.progress_percent ? Number(batch.progress_percent) : 0,
                client_lot_progress: l.progress_percent ? Number(l.progress_percent) : 0
              }
            });
          }
        }

        // 3b. Lote bloqueado
        if (l.status === 'blocked') {
          const signature = `blocked_lot:${l.id}`;
          activeSignatures.add(signature);
          alertsTriggered.push({
            signature,
            cell: 'Fábrica',
            message: `O Lote ${l.lot_code} encontra-se BLOQUEADO para produção. Libere as pendências.`,
            severity: 'critical',
            metadata: {
              type: 'blocked_lot',
              lot_id: l.id,
              lot_code: l.lot_code,
              customer_name: customerName,
              general_lot_code: batch.general_lot_code || 'N/A',
              general_lot_progress: batch.progress_percent ? Number(batch.progress_percent) : 0,
              client_lot_progress: l.progress_percent ? Number(l.progress_percent) : 0
            }
          });
        }
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 4. DIAGNÓSTICO: Retrabalho Pendente
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
          metadata: {
            type: 'pending_rework',
            rework_order_id: rw.id,
            piece_id: rw.original_piece_id
          }
        });
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 5. DIAGNÓSTICO: Embalagem Incompleta (>12h)
    // ─────────────────────────────────────────────────────────────
    const { data: packagingLots, error: packagingError } = await supabase
      .from('production_lots')
      .select('id, lot_code, status, updated_at, customer_name, progress_percent, pcp_import_batch_id')
      .eq('status', 'waiting_packaging');

    if (packagingError && !isOptionalSchemaError(packagingError)) throw packagingError;

    if (packagingLots) {
      packagingLots.forEach(l => {
        const batch = batchMap[l.pcp_import_batch_id] || {};
        const timeSinceProductionMs = nowDate - new Date(l.updated_at);
        const timeSinceProductionHours = timeSinceProductionMs / (1000 * 60 * 60);

        if (timeSinceProductionHours > 12) {
          const signature = `incomplete_package:${l.id}`;
          activeSignatures.add(signature);
          alertsTriggered.push({
            signature,
            cell: 'Embalagem',
            message: `Lote ${l.lot_code} aguarda embalagem há mais de ${Math.round(timeSinceProductionHours)}h após fim da usinagem/marcenaria.`,
            severity: 'warning',
            metadata: {
              type: 'incomplete_package',
              lot_id: l.id,
              lot_code: l.lot_code,
              customer_name: l.customer_name || 'Desconhecido',
              hours: timeSinceProductionHours,
              general_lot_code: batch.general_lot_code || 'N/A',
              general_lot_progress: batch.progress_percent ? Number(batch.progress_percent) : 0,
              client_lot_progress: l.progress_percent ? Number(l.progress_percent) : 0
            }
          });
        }
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 6. DIAGNÓSTICO: Coletas com status error & pending/processing travadas (>15 min)
    // ─────────────────────────────────────────────────────────────
    const oneDayAgo = new Date(nowDate - 24 * 60 * 60 * 1000).toISOString();
    const { data: collectionEvents, error: colError } = await supabase
      .from('production_collection_events')
      .select('id, cell_name, operator_name, status, result_status, error_message, created_at, lot_code, customer_name')
      .gte('created_at', oneDayAgo);

    if (colError && !isOptionalSchemaError(colError)) throw colError;

    if (collectionEvents) {
      collectionEvents.forEach(evt => {
        // 6a. Erro de Coleta
        if (evt.status === 'error' || evt.result_status === 'error') {
          const signature = `collection_error:${evt.id}`;
          activeSignatures.add(signature);
          alertsTriggered.push({
            signature,
            cell: evt.cell_name || 'Coleta',
            message: `Falha na coleta: Célula ${evt.cell_name || 'N/A'} - Operador ${evt.operator_name || 'N/A'} - Detalhe: ${evt.error_message || 'Erro de sincronização'}`,
            severity: 'warning',
            metadata: {
              type: 'collection_error',
              event_id: evt.id,
              cell_name: evt.cell_name,
              operator_name: evt.operator_name,
              error_message: evt.error_message,
              lot_code: evt.lot_code,
              customer_name: evt.customer_name,
              created_at: evt.created_at
            }
          });
        }

        // 6b. Coleta travada (>15 minutos)
        const timeSpentMs = nowDate - new Date(evt.created_at);
        if ((evt.status === 'pending' || evt.status === 'processing') && timeSpentMs > 15 * 60 * 1000) {
          const signature = `stuck_collection:${evt.id}`;
          activeSignatures.add(signature);
          alertsTriggered.push({
            signature,
            cell: evt.cell_name || 'Coleta',
            message: `Coleta travada em status "${evt.status}" na célula ${evt.cell_name || 'N/A'} desde ${new Date(evt.created_at).toLocaleString('pt-BR')}.`,
            severity: 'warning',
            metadata: {
              type: 'stuck_collection',
              event_id: evt.id,
              cell_name: evt.cell_name,
              operator_name: evt.operator_name,
              status: evt.status,
              lot_code: evt.lot_code,
              customer_name: evt.customer_name,
              created_at: evt.created_at
            }
          });
        }
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 7. DIAGNÓSTICO: Aumento anormal de rejeições ou leituras duplicadas
    // ─────────────────────────────────────────────────────────────
    const oneHourAgo = new Date(nowDate - 60 * 60 * 1000).toISOString();
    const { data: recentReadings, error: readError } = await supabase
      .from('production_stage_readings')
      .select('cell_name, status, created_at')
      .gte('created_at', oneHourAgo);

    if (readError && !isOptionalSchemaError(readError)) throw readError;

    if (recentReadings) {
      const rejectionsByCell = {};
      const duplicatesByCell = {};

      recentReadings.forEach(r => {
        const cell = r.cell_name || 'Fábrica';
        if (r.status === 'rejected' || r.status === 'error') {
          rejectionsByCell[cell] = (rejectionsByCell[cell] || 0) + 1;
        } else if (r.status === 'duplicate' || r.status === 'duplicated') {
          duplicatesByCell[cell] = (duplicatesByCell[cell] || 0) + 1;
        }
      });

      // Volume anormal de rejeições (limite: 5 na última hora)
      Object.entries(rejectionsByCell).forEach(([cell, count]) => {
        if (count >= 5) {
          const dateHourStr = nowDate.toISOString().substring(0, 13); // Agrupa por hora
          const signature = `high_rejections:${cell}:${dateHourStr}`;
          activeSignatures.add(signature);
          alertsTriggered.push({
            signature,
            cell,
            message: `Aumento anormal de rejeições na célula ${cell}: ${count} ocorrências na última hora.`,
            severity: 'warning',
            metadata: { type: 'high_rejections', cell, count }
          });
        }
      });

      // Volume anormal de duplicados (limite: 10 na última hora)
      Object.entries(duplicatesByCell).forEach(([cell, count]) => {
        if (count >= 10) {
          const dateHourStr = nowDate.toISOString().substring(0, 13);
          const signature = `high_duplicates:${cell}:${dateHourStr}`;
          activeSignatures.add(signature);
          alertsTriggered.push({
            signature,
            cell,
            message: `Volume anormal de leituras duplicadas na célula ${cell}: ${count} bipagens repetidas na última hora.`,
            severity: 'warning',
            metadata: { type: 'high_duplicates', cell, count }
          });
        }
      });
    }

    // ─────────────────────────────────────────────────────────────
    // 8. SALVAR E RECONCILIAR NO BANCO DE DADOS VIA RPC
    // ─────────────────────────────────────────────────────────────
    const { data: reconcileResult, error: reconcileError } = await supabase
      .rpc('reconcile_mes_alerts', {
        p_alerts: alertsTriggered.map((alert) => ({
          signature: alert.signature,
          cell: alert.cell,
          message: alert.message,
          severity: alert.severity,
          metadata: alert.metadata
        })),
        p_active_signatures: Array.from(activeSignatures)
      });

    if (reconcileError) throw reconcileError;

    const activeAlerts = await getActiveAlerts();

    return {
      success: true,
      alertsTriggeredCount: alertsTriggered.length,
      activeAlertsCount: activeAlerts.length,
      activeAlerts,
      reconcileResult
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
 * Força a resolução manual de um alerta de forma transacional usando a RPC.
 * 
 * @param {string} alertId - UUID do alerta
 * @param {string} note - Observação ou justificativa
 */
export async function resolveAlertManually(alertId, note = 'Resolvido manualmente.') {
  if (!alertId) throw new Error('Alerta ID é obrigatório.');

  const { data, error } = await supabase
    .rpc('resolve_mes_alert', {
      p_alert_id: alertId,
      p_resolution_note: note
    });

  if (error) throw error;
  return data;
}
