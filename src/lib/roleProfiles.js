import { getDefaultPermissions } from '@/config/appRoutes';

export const SYSTEM_ROLE_OPTIONS = Object.freeze([
  { value: 'operator', label: 'Operador / Usuário', shortLabel: 'Operador', rank: 10 },
  { value: 'viewer', label: 'Visualizador / Auditor', shortLabel: 'Visualizador', rank: 10 },
  { value: 'supervisor', label: 'Supervisor / Líder', shortLabel: 'Supervisor / Líder', rank: 20 },
  { value: 'quality_manager', label: 'Qualidade', shortLabel: 'Qualidade', rank: 25 },
  { value: 'manager', label: 'Gestor', shortLabel: 'Gestor', rank: 30 },
  { value: 'admin', label: 'Administrador', shortLabel: 'Administrador', rank: 40 },
]);

const QUALITY_PERMISSION_OVERRIDES = Object.freeze({
  view_dashboards: true,
  register_production: false,
  manage_occurrences: true,
  view_occurrences: true,
  manage_cells: false,
  view_cells: true,
  manage_operators: false,
  view_operators: true,
  view_reports: true,
  ai_operations: false,
  view_ai: false,
  manage_automations: false,
  view_automations: true,
  manage_users: false,
  view_users: false,
  view_pcp: true,
  manage_pcp: false,
  view_manual_production: false,
  register_manual_production: false,
  view_routes: true,
  manage_routes: false,
  view_collection: true,
  traceability_collect: false,
  view_traceability: true,
  manage_lot_integrity: false,
  view_joinery: true,
  manage_joinery: false,
  view_oee: true,
  view_daily_summary: true,
  view_gamification: false,
  view_backups: false,
  manage_backups: false,
  view_integrity_logs: true,
  view_packaging: true,
  manage_packaging: false,
  view_shipping: true,
  manage_shipping: false,
  view_mes_alerts: true,
  resolve_mes_alerts: true,
  send_reports: false,
  schedule_reports: false,
  manage_report_recipients: false,
  view_report_delivery_logs: false,
  manage_email_settings: false,
  view_audit_logs: false,
  view_quality: true,
  manage_quality: true,
  close_quality_nonconformities: true,
  register_downtime: false,
  manage_downtime_reasons: true,
  correct_downtime: true,
});

const REPLACEMENT_AUTHORITY_PERMISSIONS = Object.freeze({
  view_replacements: true,
  manage_replacements: true,
  approve_replacements: true,
  force_complete_replacements: true,
});

const REPLACEMENT_NON_AUTHORITY_PERMISSIONS = Object.freeze({
  view_replacements: true,
  manage_replacements: false,
  approve_replacements: false,
  force_complete_replacements: false,
});

export function normalizeSystemRole(role) {
  const normalized = String(role || 'operator').trim().toLowerCase();
  if (normalized === 'quality') return 'quality_manager';
  if (normalized === 'leader') return 'supervisor';
  if (normalized === 'user') return 'operator';
  return normalized;
}

export function getSystemRoleOption(role) {
  const normalized = normalizeSystemRole(role);
  return SYSTEM_ROLE_OPTIONS.find((option) => option.value === normalized) || null;
}

export function getSystemRoleLabel(role, { short = false } = {}) {
  const option = getSystemRoleOption(role);
  if (!option) return role || 'Operador';
  return short ? option.shortLabel : option.label;
}

export function getSystemRoleRank(role) {
  return getSystemRoleOption(role)?.rank || 0;
}

export function isReplacementAuthorityRole(role) {
  return ['quality_manager', 'supervisor', 'manager', 'admin'].includes(normalizeSystemRole(role));
}

export function getRoleDefaultPermissions(role) {
  const normalized = normalizeSystemRole(role);
  const base = normalized === 'quality_manager'
    ? { ...getDefaultPermissions('supervisor'), ...QUALITY_PERMISSION_OVERRIDES }
    : getDefaultPermissions(normalized);

  return isReplacementAuthorityRole(normalized)
    ? { ...base, ...REPLACEMENT_AUTHORITY_PERMISSIONS }
    : { ...base, ...REPLACEMENT_NON_AUTHORITY_PERMISSIONS };
}

export function creatorAuthorityRank(creator) {
  const roleRank = getSystemRoleRank(creator?.role);
  if (creator?.permissions?.manage_users === true) return Math.max(roleRank, 20);
  if (creator?.permissions?.manage_operators === true) return Math.max(roleRank, 15);
  return roleRank;
}

export function canManageSystemRole(currentUser, targetRole) {
  if (normalizeSystemRole(currentUser?.role) === 'admin') return true;
  return getSystemRoleRank(targetRole) < creatorAuthorityRank(currentUser);
}
