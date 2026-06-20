function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
}

function shell(title: string, eyebrow: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f4f6f5;font-family:Arial,sans-serif;color:#111827"><table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td align="center" style="padding:24px"><table width="680" cellpadding="0" cellspacing="0" role="presentation" style="max-width:680px;width:100%;background:#ffffff;border:1px solid #dfe5e1"><tr><td style="background:#00522d;padding:20px 24px"><div style="font-size:26px;font-weight:800;color:#fff200">Leo</div><div style="font-size:12px;color:#ffffff">AC.Prod - Controle e Rastreabilidade</div></td></tr><tr><td style="padding:24px"><div style="font-size:12px;font-weight:700;color:#047857;text-transform:uppercase">${escapeHtml(eyebrow)}</div><h1 style="font-size:24px;margin:8px 0 16px">${escapeHtml(title)}</h1>${body}</td></tr><tr><td style="padding:16px 24px;border-top:1px solid #e5e7eb;font-size:11px;color:#6b7280">Mensagem automática e auditada pelo AC.Prod.</td></tr></table></td></tr></table></body></html>`;
}

function kpis(summary: any) {
  const items = [['Pedidos', summary.orderCount || 0], ['Cargas', summary.loadCount || 0], ['Produzido', summary.produced], ['Aprovado', summary.approved || 0], ['Reprovado', summary.rejected || 0], ['Pendente', summary.pending || 0], ['Meta', summary.target], ['Eficiência', `${Number(summary.efficiency || 0).toFixed(1)}%`], ['Paradas', `${summary.downtime || 0} min`], ['Lotes bloqueados', summary.blockedLots || 0]];
  return `<table width="100%" cellpadding="8" cellspacing="0" style="border-collapse:collapse">${items.map(([label, value]) => `<tr><td style="border-bottom:1px solid #e5e7eb;color:#6b7280">${escapeHtml(label)}</td><td align="right" style="border-bottom:1px solid #e5e7eb;font-weight:700">${escapeHtml(value)}</td></tr>`).join('')}</table>`;
}

export function managerTemplate(title: string, summary: any, message = '') { return shell(title, 'Resumo para gestores', `<p style="line-height:1.5">${escapeHtml(message)}</p>${kpis(summary)}`); }
export function lotTemplate(title: string, summary: any, message = '') { return shell(title, 'Situação de lote', `<p style="line-height:1.5">${escapeHtml(message)}</p>${kpis(summary)}`); }
export function cellTemplate(title: string, summary: any, message = '') { return shell(title, 'Desempenho da célula', `<p style="line-height:1.5">${escapeHtml(message)}</p>${kpis(summary)}`); }
export function alertTemplate(title: string, summary: any, message = '') { return shell(title, 'Alerta operacional', `<div style="border-left:4px solid #dc2626;padding:12px;background:#fef2f2">${escapeHtml(message)}</div>${kpis(summary)}`); }

export function renderEmailTemplate(code: string, title: string, summary: any, message = '') {
  if (code === 'lot-status') return lotTemplate(title, summary, message);
  if (code === 'cell-performance') return cellTemplate(title, summary, message);
  if (code === 'critical-alert') return alertTemplate(title, summary, message);
  return managerTemplate(title, summary, message);
}
