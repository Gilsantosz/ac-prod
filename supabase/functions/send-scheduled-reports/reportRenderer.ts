import { REPORT_TYPE_LABELS, LEO_LOGO_URL } from "./labels.ts";

const fmt = (n: number | string) => (Number(n) || 0).toLocaleString('pt-BR');
function acc(list: any[]) {
  const produced = list.reduce((a, e) => a + (Number(e.produced) || 0), 0);
  const scrap = list.reduce((a, e) => a + (Number(e.scrap) || 0), 0);
  const downtime = list.reduce((a, e) => a + (Number(e.downtime) || 0), 0);
  const good = Math.max(produced - scrap, 0);
  const scrapRate = produced > 0 ? Math.round((scrap / produced) * 1000) / 10 : 0;
  return { produced, scrap, good, downtime, scrapRate };
}
const pct = (n: number) => Math.round(n * 100 * 10) / 10;
function computeOeeStats(entries: any[], getCell: (cellName: string) => any) {
  const produced = entries.reduce((a, e) => a + (Number(e.produced) || 0), 0);
  const target = entries.reduce((a, e) => a + (Number(e.target) || 0), 0);
  const scrap = entries.reduce((a, e) => a + (Number(e.scrap) || 0), 0);
  const downtimeMin = entries.reduce((a, e) => a + (Number(e.downtime) || 0), 0);

  const seen = new Set();
  let plannedMin = 0;
  entries.forEach((e) => {
    const k = `${e.date}|${e.cell}|${e.shift}`;
    if (seen.has(k)) return;
    seen.add(k);
    const cell = getCell ? getCell(e.cell) : null;
    const sh = cell ? (cell.shift_hours || {}) : {};
    
    let hours = 8;
    if (e.shift === '1º Turno') hours = Number(sh.shift1 ?? 8);
    else if (e.shift === '2º Turno') hours = Number(sh.shift2 ?? 8);
    else if (e.shift === '3º Turno') hours = Number(sh.shift3 ?? 8);
    
    plannedMin += hours * 60;
  });

  const operatingMin = Math.max(plannedMin - downtimeMin, 0);
  const availability = plannedMin > 0 ? operatingMin / plannedMin : 0;
  const performance = target > 0 ? Math.min(produced / target, 1.5) : 0;
  const goodParts = Math.max(produced - scrap, 0);
  const quality = produced > 0 ? goodParts / produced : 0;
  const oee = availability * performance * quality;

  return {
    availability: pct(availability),
    performance: pct(performance),
    quality: pct(quality),
    oee: pct(oee),
    plannedMin,
    operatingMin,
    downtimeMin,
    produced,
    target,
    scrap,
    goodParts,
  };
}
function computeOeeByCell(entries: any[], cells: any[]) {
  const getCell = (cellName: string) => cells?.find(c => c.name === cellName) || null;
  const byCell: Record<string, any[]> = {};
  entries.forEach((e) => {
    if (!e.cell) return;
    (byCell[e.cell] = byCell[e.cell] || []).push(e);
  });
  return Object.entries(byCell)
    .map(([cell, list]) => ({ cell, ...computeOeeStats(list, getCell) }))
    .sort((a, b) => a.oee - b.oee);
}
export function renderReportFragmentHtml(type: string, data: any, cellsData?: any[]) {
  if (type === 'daily_production' || type === 'shift_closure') {
    const entries = data as any[];
    const total = acc(entries);

    const byCellMap: Record<string, any[]> = {};
    entries.forEach((e) => {
      if (!e.cell) return;
      (byCellMap[e.cell] = byCellMap[e.cell] || []).push(e);
    });
    const rows = Object.entries(byCellMap)
      .map(([cell, list]) => ({ cell, ...acc(list) }))
      .sort((a, b) => b.produced - a.produced);

    const cellRows = rows.map((r) => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;font-family:sans-serif;">${r.cell}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${fmt(r.produced)}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${fmt(r.good)}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${fmt(r.scrap)}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${r.scrapRate}%</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${fmt(r.downtime)}</td>
      </tr>`).join('');

    return `
      <h3 style="font-family:sans-serif;font-size:14px;color:#0f172a;margin-top:0;">Resumo Geral de Produção</h3>
      <table style="border-collapse:collapse;width:100%;margin-bottom:20px;font-family:sans-serif;font-size:13px;">
        <tr style="background:#f8fafc;"><td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;">Total Produzido</td><td style="padding:10px;border:1px solid #e2e8f0;">${fmt(total.produced)} peças</td></tr>
        <tr><td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;">Peças Boas</td><td style="padding:10px;border:1px solid #e2e8f0;">${fmt(total.good)} peças</td></tr>
        <tr style="background:#f8fafc;"><td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;">Total Refugado</td><td style="padding:10px;border:1px solid #e2e8f0;">${fmt(total.scrap)} peças (${total.scrapRate}%)</td></tr>
        <tr><td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;">Minutos de Parada</td><td style="padding:10px;border:1px solid #e2e8f0;">${fmt(total.downtime)} min</td></tr>
      </table>

      <h3 style="font-family:sans-serif;font-size:14px;color:#0f172a;">Produção por Célula</h3>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;">
        <thead>
          <tr style="background:#0f172a;color:#fff;">
            <th style="padding:6px 10px;text-align:left;">Célula</th>
            <th style="padding:6px 10px;text-align:right;">Produzido</th>
            <th style="padding:6px 10px;text-align:right;">Boas</th>
            <th style="padding:6px 10px;text-align:right;">Refugo</th>
            <th style="padding:6px 10px;text-align:right;">% Refugo</th>
            <th style="padding:6px 10px;text-align:right;">Paradas (min)</th>
          </tr>
        </thead>
        <tbody>
          ${cellRows || '<tr><td colspan="6" style="padding:15px;text-align:center;color:#64748b;">Nenhum registro para o período.</td></tr>'}
        </tbody>
      </table>
    `;
  }

  if (type === 'oee') {
    const entries = data as any[];
    const getCell = (cellName: string) => cellsData?.find(c => c.name === cellName) || null;
    const overall = computeOeeStats(entries, getCell);
    const byCell = computeOeeByCell(entries, cellsData || []);

    const byCellRows = byCell.map(r => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;font-family:sans-serif;font-weight:bold;">${r.cell}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;font-weight:bold;color:#0f172a;">${r.oee}%</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${r.availability}%</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${r.performance}%</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${r.quality}%</td>
      </tr>
    `).join('');

    return `
      <h3 style="font-family:sans-serif;font-size:14px;color:#0f172a;margin-top:0;">Indicadores OEE (Global)</h3>
      <table style="border-collapse:collapse;width:100%;margin-bottom:20px;font-family:sans-serif;font-size:13px;">
        <tr style="background:#f8fafc;">
          <td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;font-family:sans-serif;">OEE Global</td>
          <td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;color:#0f172a;font-family:sans-serif;">${overall.oee}%</td>
        </tr>
        <tr>
          <td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;font-family:sans-serif;">Disponibilidade</td>
          <td style="padding:10px;border:1px solid #e2e8f0;font-family:sans-serif;">${overall.availability}% (${fmt(overall.downtimeMin)} min de parada)</td>
        </tr>
        <tr style="background:#f8fafc;">
          <td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;font-family:sans-serif;">Performance</td>
          <td style="padding:10px;border:1px solid #e2e8f0;font-family:sans-serif;">${overall.performance}% (${fmt(overall.produced)} produzidas / ${fmt(overall.target)} meta)</td>
        </tr>
        <tr>
          <td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;font-family:sans-serif;">Qualidade</td>
          <td style="padding:10px;border:1px solid #e2e8f0;font-family:sans-serif;">${overall.quality}% (${fmt(overall.goodParts)} boas / ${fmt(overall.scrap)} refugo)</td>
        </tr>
      </table>

      <h3 style="font-family:sans-serif;font-size:14px;color:#0f172a;">OEE por Célula</h3>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;">
        <thead>
          <tr style="background:#0f172a;color:#fff;">
            <th style="padding:6px 10px;text-align:left;">Célula</th>
            <th style="padding:6px 10px;text-align:right;">OEE</th>
            <th style="padding:6px 10px;text-align:right;">Disponibilidade</th>
            <th style="padding:6px 10px;text-align:right;">Performance</th>
            <th style="padding:6px 10px;text-align:right;">Qualidade</th>
          </tr>
        </thead>
        <tbody>
          ${byCellRows || '<tr><td colspan="5" style="padding:15px;text-align:center;color:#64748b;">Nenhum dado OEE registrado nos últimos 7 dias.</td></tr>'}
        </tbody>
      </table>
    `;
  }

  if (type === 'traceability_pending' || type === 'lots_delayed' || type === 'packaging_pending') {
    const lots = data as any[];
    return `
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;">
        <thead>
          <tr style="background:#0f172a;color:#fff;">
            <th style="padding:8px;text-align:left;">Código Lote</th>
            <th style="padding:8px;text-align:left;">Ordem de Produção</th>
            <th style="padding:8px;text-align:left;">Status Atual</th>
            <th style="padding:8px;text-align:left;">Prazo Entrega</th>
          </tr>
        </thead>
        <tbody>
          ${lots.map(l => `
            <tr>
              <td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold;font-family:sans-serif;">${l.lot_code || ''}</td>
              <td style="padding:8px;border:1px solid #e2e8f0;font-family:sans-serif;">${l.production_orders?.order_code || ''}</td>
              <td style="padding:8px;border:1px solid #e2e8f0;font-family:sans-serif;"><span style="padding:2px 6px;border-radius:4px;background:#f1f5f9;font-size:11px;">${l.status || ''}</span></td>
              <td style="padding:8px;border:1px solid #e2e8f0;font-family:sans-serif;">${l.delivery_date ? new Date(l.delivery_date).toLocaleDateString('pt-BR') : '-'}</td>
            </tr>
          `).join('') || '<tr><td colspan="4" style="padding:15px;text-align:center;color:#64748b;font-family:sans-serif;">Nenhum lote correspondente encontrado.</td></tr>'}
        </tbody>
      </table>
    `;
  }

  if (type === 'shipping_pending') {
    const packages = data as any[];
    return `
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;">
        <thead>
          <tr style="background:#0f172a;color:#fff;">
            <th style="padding:8px;text-align:left;">Código Embalagem</th>
            <th style="padding:8px;text-align:left;">Volume</th>
            <th style="padding:8px;text-align:left;">Status</th>
            <th style="padding:8px;text-align:left;">Remessa</th>
            <th style="padding:8px;text-align:left;">Criado em</th>
          </tr>
        </thead>
        <tbody>
          ${packages.map(p => `
            <tr>
              <td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold;font-family:sans-serif;">${p.package_code || ''}</td>
              <td style="padding:8px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${p.volume_number || 1}</td>
              <td style="padding:8px;border:1px solid #e2e8f0;font-family:sans-serif;"><span style="padding:2px 6px;border-radius:4px;background:#f1f5f9;font-size:11px;">${p.status || ''}</span></td>
              <td style="padding:8px;border:1px solid #e2e8f0;font-family:sans-serif;">${p.shipments?.shipment_code || '-'}</td>
              <td style="padding:8px;border:1px solid #e2e8f0;font-family:sans-serif;">${p.created_at ? new Date(p.created_at).toLocaleDateString('pt-BR') : '-'}</td>
            </tr>
          `).join('') || '<tr><td colspan="5" style="padding:15px;text-align:center;color:#64748b;font-family:sans-serif;">Nenhuma embalagem pendente encontrada.</td></tr>'}
        </tbody>
      </table>
    `;
  }

  if (type === 'executive_summary') {
    const summary = data as any;
    const occurrences = summary.activeOccurrences as any[];

    const occurrenceRows = occurrences.map(o => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;font-family:sans-serif;font-weight:bold;">${o.cell}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;font-family:sans-serif;">${o.reason}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${o.downtime} min</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;font-size:12px;color:#64748b;font-family:sans-serif;">${o.notes || ''}</td>
      </tr>
    `).join('');

    return `
      <div style="background:#f8fafc; border: 1px solid #e2e8f0; padding:15px; border-radius:6px; margin-bottom:20px; font-family:sans-serif;">
        <p style="margin:0 0 6px 0; font-size:14px; font-weight:bold; color:#0f172a;">Lotes em Atraso Ativos</p>
        <p style="margin:0; font-size:24px; font-weight:bold; color:#dc2626;">${summary.delayedCount}</p>
      </div>

      <h3 style="font-family:sans-serif;font-size:14px;color:#0f172a;">Ocorrências Ativas (Em Aberto)</h3>
      <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:13px;">
        <thead>
          <tr style="background:#0f172a;color:#fff;">
            <th style="padding:6px 10px;text-align:left;">Célula</th>
            <th style="padding:6px 10px;text-align:left;">Motivo</th>
            <th style="padding:6px 10px;text-align:right;">Parada</th>
            <th style="padding:6px 10px;text-align:left;">Notas</th>
          </tr>
        </thead>
        <tbody>
          ${occurrenceRows || '<tr><td colspan="4" style="padding:15px;text-align:center;color:#64748b;font-family:sans-serif;">Nenhuma ocorrência em aberto no momento.</td></tr>'}
        </tbody>
      </table>
    `;
  }

  return `
    <p style="font-family:sans-serif;font-size:14px;color:#334155;">
      Este e-mail contém o relatório de <b>${REPORT_TYPE_LABELS[type] || type}</b> solicitado para o período.
    </p>
    <p style="font-family:sans-serif;font-size:13px;color:#64748b;">
      Caso existam anexos no formato CSV/Excel, verifique a seção de anexos da sua mensagem.
    </p>
  `;
}
export function wrapEmailTemplate(schedule: any, bodyContent: string) {
  return `
    <div style="font-family:sans-serif;color:#1e293b;max-width:680px;margin:0 auto;border:1px solid #dbe3ea;border-radius:14px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,0.08);">
      <div style="background:#00522d;color:#ffffff;padding:18px 22px;display:flex;align-items:center;gap:14px;">
        <img src="${LEO_LOGO_URL}" alt="Leo Madeiras" width="54" height="54" style="border-radius:12px;border:2px solid #ffffff;display:block;" />
        <div>
          <h2 style="margin:0;font-size:20px;letter-spacing:0.2px;color:#ffed00;">Leo Madeiras</h2>
          <p style="margin:4px 0 0 0;font-size:13px;color:#ffffff;">AC.Prod - Relatórios Industriais</p>
        </div>
      </div>
      <div style="padding:24px;background:#ffffff;">
        <h2 style="margin-top:0;font-size:18px;color:#0f172a;">${schedule.name}</h2>
        <p style="font-size:12px;color:#64748b;margin-bottom:20px;">Frequência: ${schedule.frequency} • Gerado em: ${new Date().toLocaleString('pt-BR')}</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin-bottom:20px;"/>
        
        ${bodyContent}

      </div>
      <div style="background:#f8fafc;padding:15px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;">
        E-mail automático gerado pelo sistema AC.Prod MES. Favor não responder diretamente a este remetente.
      </div>
    </div>
  `;
}
