function escapeHtml(value: unknown) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char),
  );
}

function number(value: unknown) {
  return Number(value) || 0;
}

function percent(value: unknown) {
  return `${number(value).toFixed(1).replace('.', ',')}%`;
}

function clampPercent(value: unknown) {
  return Math.max(0, Math.min(100, number(value)));
}

function shell(title: string, eyebrow: string, body: string) {
  return `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;background:#eef2ef;font-family:Arial,Helvetica,sans-serif;color:#17211b">
<div style="display:none;max-height:0;overflow:hidden">Relatório operacional Leo Flow atualizado com dados reais do sistema.</div>
<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  <tr><td align="center" style="padding:24px 10px">
    <table width="720" cellpadding="0" cellspacing="0" role="presentation" style="max-width:720px;width:100%;background:#ffffff;border:1px solid #d9e2dc;border-radius:18px;overflow:hidden">
      <tr><td style="background:#005b35;padding:22px 26px">
        <table width="100%" role="presentation"><tr>
          <td><div style="font-size:30px;font-weight:900;color:#fff200;line-height:1">Leo</div><div style="font-size:12px;color:#d9f5e6;margin-top:5px">Leo Flow · Controle e Rastreabilidade</div></td>
          <td align="right" style="font-size:11px;color:#d9f5e6">RELATÓRIO AUDITADO<br>${escapeHtml(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:26px">
        <div style="font-size:11px;font-weight:800;color:#07844b;text-transform:uppercase;letter-spacing:1px">${escapeHtml(eyebrow)}</div>
        <h1 style="font-size:25px;line-height:1.2;margin:8px 0 20px;color:#102119">${escapeHtml(title)}</h1>
        ${body}
      </td></tr>
      <tr><td style="padding:17px 26px;border-top:1px solid #e4eae6;font-size:11px;line-height:1.5;color:#68756e">
        Mensagem automática e auditada pelo Leo Flow. Os números refletem o banco no momento do envio.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function kpiCard(label: string, value: unknown, color = '#005b35') {
  return `<td width="33.33%" style="padding:5px;vertical-align:top">
    <div style="border:1px solid #dfe7e2;border-radius:12px;padding:13px;background:#fafcfb">
      <div style="font-size:10px;text-transform:uppercase;color:#6b776f;font-weight:700">${escapeHtml(label)}</div>
      <div style="font-size:22px;line-height:1.25;font-weight:900;color:${color};margin-top:4px">${escapeHtml(value)}</div>
    </div>
  </td>`;
}

function kpis(summary: any) {
  const items = [
    ['Produzido', number(summary.produced).toLocaleString('pt-BR'), '#07844b'],
    ['Meta', number(summary.target).toLocaleString('pt-BR'), '#17211b'],
    ['Eficiência', percent(summary.efficiency), '#0b76b7'],
    ['Aprovado', number(summary.approved).toLocaleString('pt-BR'), '#07844b'],
    ['Pendente', number(summary.pending).toLocaleString('pt-BR'), '#d97706'],
    ['Reprovado', number(summary.rejected).toLocaleString('pt-BR'), '#dc2626'],
    ['OEE', percent(summary.oee), '#6d28d9'],
    ['Paradas', `${number(summary.downtime).toLocaleString('pt-BR')} min`, '#d97706'],
    ['Lotes bloqueados', number(summary.blockedLots).toLocaleString('pt-BR'), '#dc2626'],
  ];
  const rows = [];
  for (let index = 0; index < items.length; index += 3) {
    rows.push(`<tr>${items.slice(index, index + 3).map(([label, value, color]) => kpiCard(label, value, color)).join('')}</tr>`);
  }
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 -5px 18px">${rows.join('')}</table>`;
}

function progressBar(label: string, completed: unknown, required: unknown, progress: unknown) {
  const normalized = clampPercent(progress);
  return `<tr>
    <td style="padding:9px 8px 9px 0;font-size:12px;font-weight:700">${escapeHtml(label)}</td>
    <td style="padding:9px 8px;font-size:11px;color:#65726a">${escapeHtml(completed)}/${escapeHtml(required)}</td>
    <td width="48%" style="padding:9px 0">
      <div style="height:9px;background:#e8eeea;border-radius:8px;overflow:hidden"><div style="width:${normalized}%;height:9px;background:#08a05c;border-radius:8px"></div></div>
    </td>
    <td align="right" style="padding:9px 0 9px 8px;font-size:11px;font-weight:800">${percent(normalized)}</td>
  </tr>`;
}

function lotSection(summary: any) {
  const general = summary.lotContext?.generalLot || summary.lotContext?.tracking?.general_lots?.[0];
  if (!general) return '';
  const stages = Array.isArray(general.stages) ? general.stages : [];
  const clientLots = Array.isArray(general.client_lots) ? general.client_lots : [];
  const rows = clientLots.slice(0, 100).map((lot: any) => `<tr>
    <td style="padding:9px;border-top:1px solid #e5ebe7;font-weight:800">${escapeHtml(lot.lot_code)}</td>
    <td style="padding:9px;border-top:1px solid #e5ebe7">${escapeHtml(lot.customer_name || 'Cliente não identificado')}</td>
    <td align="right" style="padding:9px;border-top:1px solid #e5ebe7">${escapeHtml(lot.ready_for_separation_pieces || 0)}/${escapeHtml(lot.total_pieces || 0)}</td>
    <td align="right" style="padding:9px;border-top:1px solid #e5ebe7;font-weight:800">${percent(lot.progress_percent)}</td>
    <td style="padding:9px;border-top:1px solid #e5ebe7">${escapeHtml(lot.bottleneck_stage || '—')}</td>
  </tr>`).join('');

  return `<div style="margin-top:20px;border:1px solid #dce6df;border-radius:14px;overflow:hidden">
    <div style="padding:16px 18px;background:#064e3b;color:#ffffff">
      <div style="font-size:10px;text-transform:uppercase;color:#a7f3d0;font-weight:700">Lote geral PCP</div>
      <div style="font-size:25px;font-weight:900;margin-top:3px">${escapeHtml(general.general_lot_code || summary.lotContext?.generalLotCode || '—')}</div>
      <div style="font-size:12px;margin-top:5px">Andamento ${percent(general.progress_percent)} · ${number(general.total_pieces).toLocaleString('pt-BR')} peças · ${clientLots.length} lotes de clientes</div>
    </div>
    ${stages.length ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="padding:10px 18px">${stages.map((stage: any) => progressBar(stage.stage_label, stage.completed_pieces, stage.required_pieces, stage.progress_percent)).join('')}</table>` : ''}
    ${clientLots.length ? `<div style="padding:8px 18px 18px;overflow-x:auto"><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:11px">
      <thead><tr style="color:#6b776f;text-transform:uppercase;font-size:9px"><th align="left" style="padding:9px">Lote cliente</th><th align="left" style="padding:9px">Cliente</th><th align="right" style="padding:9px">Prontas</th><th align="right" style="padding:9px">Andamento</th><th align="left" style="padding:9px">Gargalo</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>` : ''}
  </div>`;
}

function baseBody(summary: any, message: string) {
  return `<p style="font-size:13px;line-height:1.6;color:#4e5d54;margin:0 0 18px">${escapeHtml(message)}</p>${kpis(summary)}${lotSection(summary)}`;
}

export function managerTemplate(title: string, summary: any, message = '') {
  return shell(title, 'Resumo para gestores', baseBody(summary, message));
}
export function lotTemplate(title: string, summary: any, message = '') {
  return shell(title, 'Andamento, integridade e previsão do lote', baseBody(summary, message));
}
export function cellTemplate(title: string, summary: any, message = '') {
  return shell(title, 'Desempenho da célula', baseBody(summary, message));
}
export function alertTemplate(title: string, summary: any, message = '') {
  return shell(title, 'Alerta operacional', `<div style="border-left:4px solid #dc2626;padding:12px;background:#fef2f2;border-radius:8px;margin-bottom:18px">${escapeHtml(message)}</div>${kpis(summary)}${lotSection(summary)}`);
}

export function renderEmailTemplate(code: string, title: string, summary: any, message = '') {
  if (code === 'lot-status') return lotTemplate(title, summary, message);
  if (code === 'cell-performance') return cellTemplate(title, summary, message);
  if (code === 'critical-alert') return alertTemplate(title, summary, message);
  return managerTemplate(title, summary, message);
}
