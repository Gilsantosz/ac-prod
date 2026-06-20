/**
 * AC.Prod — Audit Log Helper
 *
 * Helper para registrar ações do usuário em system_audit_logs.
 * Chamado no frontend para eventos que NÃO são cobertos pelos triggers do banco.
 *
 * SEGURANÇA: Usa apenas a chave ANON. Toda inserção é validada via RLS.
 * Nunca inclui senhas ou dados sensíveis no metadata.
 */

import { supabase } from './supabaseClient';

/**
 * Registra uma ação de auditoria no sistema.
 *
 * @param {string} action - Ação realizada (ex: 'login', 'export_report', 'import_xml')
 * @param {string} entity - Entidade afetada (ex: 'production_order', 'lot', 'user')
 * @param {string|null} entityId - ID da entidade, se disponível
 * @param {object} metadata - Dados adicionais contextuais (sem senhas!)
 * @param {object} options - Opções extras (success, errorMessage, oldValue, newValue)
 */
export async function auditLog(
  action,
  entity = null,
  entityId = null,
  metadata = {},
  options = {}
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // Não logado, silenciosamente ignora

    const { data: profile } = await supabase
      .from('profiles')
      .select('name, email, role')
      .eq('id', user.id)
      .single();

    // Remove dados sensíveis do metadata
    const safeMeta = { ...metadata };
    delete safeMeta.password;
    delete safeMeta.token;
    delete safeMeta.secret;
    delete safeMeta.key;

    await supabase.from('system_audit_logs').insert({
      user_id:       user.id,
      user_name:     profile?.name || user.email,
      user_email:    profile?.email || user.email,
      user_role:     profile?.role || 'operator',
      action,
      entity,
      entity_id:     entityId ? String(entityId) : null,
      entity_label:  options.entityLabel || null,
      page:          options.page || (typeof window !== 'undefined' ? window.location.pathname : null),
      route:         options.route || null,
      method:        options.method || 'frontend',
      old_value:     options.oldValue || null,
      new_value:     options.newValue || null,
      metadata:      safeMeta,
      user_agent:    typeof navigator !== 'undefined' ? navigator.userAgent : null,
      success:       options.success !== false,
      error_message: options.errorMessage || null,
      created_at:    new Date().toISOString(),
    });
  } catch (err) {
    // Auditoria não pode quebrar o fluxo principal
    console.warn('[auditLog] Falha silenciosa:', err?.message);
  }
}

// ─── Ações pré-definidas para consistência ──────────────────
export const AUDIT_ACTIONS = {
  // Auth
  LOGIN:                    'login',
  LOGOUT:                   'logout',
  LOGIN_FAILED:             'login_failed',
  PAGE_ACCESS:              'page_access',

  // Produção
  PRODUCTION_CREATE:        'production_create',
  PRODUCTION_UPDATE:        'production_update',
  PRODUCTION_DELETE:        'production_delete',

  // Ocorrências
  OCCURRENCE_CREATE:        'occurrence_create',
  ALERT_RESOLVE:            'alert_resolve',

  // Promob
  PROMOB_XML_IMPORT:        'promob_xml_import',
  PROMOB_API_SYNC:          'promob_api_sync',

  // Rastreabilidade
  ORDER_CREATE:             'order_create',
  LOT_UPDATE:               'lot_update',
  PIECE_MOVE:               'piece_move',
  STEP_START:               'step_start',
  STEP_FINISH:              'step_finish',
  STEP_SCRAP:               'step_scrap',
  STEP_REWORK:              'step_rework',
  LOT_BLOCK:                'lot_block',
  LOT_UNBLOCK:              'lot_unblock',

  // Embalagem e expedição
  PACKAGE_CREATE:           'package_create',
  PACKAGE_CLOSE:            'package_close',
  SHIPMENT_DISPATCH:        'shipment_dispatch',

  // Relatórios
  REPORT_EXPORT:            'report_export',
  BACKUP_DOWNLOAD:          'backup_download',

  // Admin
  USER_UPDATE:              'user_update',
  PERMISSION_CHANGE:        'permission_change',
  API_CONFIG_CHANGE:        'api_config_change',
  BACKUP_CONFIG_CHANGE:     'backup_config_change',
};
