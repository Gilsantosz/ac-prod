export function canExecuteAiAction(user, action, scope = {}) {
  if (!user) return false;
  if (user.role === 'admin') return true;

  const permissions = user.permissions || {};

  // Gestor can generate, send, and schedule within their cell scope
  if (user.role === 'manager') {
    if ([
      'generate_report',
      'send_report_email',
      'schedule_report_email',
      'list_schedules',
      'show_email_logs',
      'show_ai_logs',
      'search_production',
      'navigate',
    ].includes(action)) {
      if (scope.cell) {
        const managed = Array.isArray(user.managed_cells) ? user.managed_cells : [];
        return managed.map(c => String(c).toLowerCase().trim()).includes(scope.cell.toLowerCase().trim());
      }
      return true;
    }
    return false;
  }

  // Operator and other roles
  if (['search_production', 'navigate'].includes(action)) {
    return permissions.view_traceability === true
      || permissions.view_reports === true
      || permissions.ai_operations === true;
  }

  if (['generate_report', 'list_schedules', 'show_ai_logs'].includes(action)) {
    return permissions.view_reports === true || permissions.ai_operations === true;
  }

  return false;
}
