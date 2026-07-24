import { REPORT_TYPE_LABELS, LEO_LOGO_URL } from "./labels.ts";

const fmt = (n: number | string) => (Number(n) || 0).toLocaleString('pt-BR');
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] || char));
const num = (value: unknown) => Number(value) || 0;
const round1 = (value: number) => Math.round(value * 10) / 10;
const extractProductionBundle = (data: any) => ({
  entries: (Array.isArray(data) ? data : data?.entries || []) as any[],
  goals: (Array.isArray(data) ? [] : data?.goals || []) as any[],
  fromDate: Array.isArray(data) ? null : data?.fromDate,
  toDate: Array.isArray(data) ? null : data?.toDate,
});
const unitKey = (row: any) => String(row?.metric_unit || row?.unit_of_measure || 'pieces').toLowerCase();
const unitLabel = (unit: string) => ({
  sheets: 'chapas', sheet: 'chapas', chapas: 'chapas',
  meters: 'metros', meter: 'metros', metros: 'metros',
  covers: 'capas', cover: 'capas', capas: 'capas',
  pieces: 'peças', piece: 'peças', pecas: 'peças', peças: 'peças',
}[unit] || unit);
const realized = (entry: any) => {
  if (entry?.realized_quantity != null) return num(entry.realized_quantity);
  const unit = unitKey(entry);
  if (['sheets', 'sheet', 'chapas'].includes(unit) && entry?.sheet_count != null) return num(entry.sheet_count);
  if (['meters', 'meter', 'metros'].includes(unit) && entry?.edge_meters != null) return num(entry.edge_meters);
  if (['covers', 'cover', 'capas'].includes(unit) && entry?.covers_quantity != null) return num(entry.covers_quantity);
  if (entry?.pieces_quantity != null) return num(entry.pieces_quantity);
  return num(entry?.produced);
};
function acc(list: any[]) {
  const produced = list.reduce((a, e) => a + realized(e), 0);
  const scrap = list.reduce((a, e) => a + (Number(e.scrap) || 0), 0);
  const downtime = list.reduce((a, e) => a + (Number(e.downtime) || 0), 0);
  const target = list.reduce((a, e) => a + num(e.planned_target ?? e.target), 0);
  const good = Math.max(produced - scrap, 0);
  const scrapRate = produced > 0 ? Math.round((scrap / produced) * 1000) / 10 : 0;
  return { produced, scrap, good, downtime, target, scrapRate };
}
function buildProductionRows(entries: any[], goals: any[], groupFields: string[]) {
  const groups = new Map<string, any>();
  const getKey = (row: any, isGoal = false) => {
    const cell = isGoal ? row.cell_name : row.cell;
    const values = groupFields.map((field) => field === 'cell' ? (cell || 'Sem célula') : (row[field] || '—'));
    return [...values, unitKey(row)].join('||');
  };
  const ensure = (row: any, isGoal = false) => {
    const key = getKey(row, isGoal);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        cell: (isGoal ? row.cell_name : row.cell) || 'Sem célula',
        shift: row.shift || '—',
        unit: unitKey(row),
        produced: 0,
        target: 0,
        scrap: 0,
        downtime: 0,
        hasGoal: false,
      });
    }
    return groups.get(key);
  };
  goals.forEach((goal) => {
    const row = ensure(goal, true);
    row.target += num(goal.target);
    row.hasGoal = true;
  });
  entries.forEach((entry) => {
    const row = ensure(entry);
    row.produced += realized(entry);
    row.scrap += num(entry.scrap);
    row.downtime += num(entry.downtime);
    if (!row.hasGoal) row.target += num(entry.planned_target ?? entry.target);
  });
  return [...groups.values()].map((row) => ({
    ...row,
    difference: round1(row.produced - row.target),
    attainment: row.target > 0 ? round1((row.produced / row.target) * 100) : 0,
  })).sort((a, b) => String(a.cell).localeCompare(String(b.cell), 'pt-BR') || String(a.shift).localeCompare(String(b.shift), 'pt-BR'));
}
function progressBar(value: number, color = '#16a34a') {
  const width = Math.max(0, Math.min(Number(value) || 0, 100));
  return `<div style="width:100%;min-width:86px;background:#e2e8f0;border-radius:999px;height:8px;overflow:hidden;"><div style="width:${width}%;height:8px;background:${color};border-radius:999px;"></div></div>`;
}
function metricCards(rows: any[]) {
  return rows.map((row) => `
    <td style="padding:6px;vertical-align:top;">
      <div style="border:1px solid #dbe3ea;border-radius:10px;padding:12px;background:#f8fafc;min-width:120px;">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:bold;">${esc(unitLabel(row.unit))}</div>
        <div style="font-size:21px;color:#0f172a;font-weight:bold;margin:4px 0;">${fmt(row.produced)}</div>
        <div style="font-size:11px;color:#64748b;">Meta ${fmt(row.target)} · ${row.attainment}%</div>
      </div>
    </td>`).join('');
}
function productionTable(rows: any[], keyFields: string[]) {
  const firstHeaders = keyFields.map((field) => field === 'cell' ? 'Célula' : 'Turno');
  const body = rows.map((row) => `
    <tr>
      ${keyFields.map((field) => `<td style="padding:7px;border:1px solid #e2e8f0;font-weight:${field === 'cell' ? 'bold' : 'normal'};">${esc(row[field])}</td>`).join('')}
      <td style="padding:7px;border:1px solid #e2e8f0;">${esc(unitLabel(row.unit))}</td>
      <td style="padding:7px;border:1px solid #e2e8f0;text-align:right;">${fmt(row.target)}</td>
      <td style="padding:7px;border:1px solid #e2e8f0;text-align:right;font-weight:bold;color:#047857;">${fmt(row.produced)}</td>
      <td style="padding:7px;border:1px solid #e2e8f0;text-align:right;color:${row.difference < 0 ? '#dc2626' : '#047857'};">${fmt(row.difference)}</td>
      <td style="padding:7px;border:1px solid #e2e8f0;min-width:105px;">${progressBar(row.attainment)}<div style="font-size:10px;text-align:right;margin-top:3px;">${row.attainment}%</div></td>
      <td style="padding:7px;border:1px solid #e2e8f0;text-align:right;">${fmt(row.downtime)}</td>
    </tr>`).join('');
  return `
    <table role="presentation" style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:12px;">
      <thead><tr style="background:#0f172a;color:#fff;">
        ${firstHeaders.map((label) => `<th style="padding:7px;text-align:left;">${label}</th>`).join('')}
        <th style="padding:7px;text-align:left;">Unidade</th><th style="padding:7px;text-align:right;">Meta</th>
        <th style="padding:7px;text-align:right;">Produzido</th><th style="padding:7px;text-align:right;">Diferença</th>
        <th style="padding:7px;text-align:left;">Atingimento</th><th style="padding:7px;text-align:right;">Paradas (min)</th>
      </tr></thead>
      <tbody>${body || `<tr><td colspan="${keyFields.length + 6}" style="padding:15px;text-align:center;color:#64748b;">Nenhum registro para o período.</td></tr>`}</tbody>
    </table>`;
}
const pct = (n: number) => Math.round(n * 100 * 10) / 10;
function computeOeeStats(entries: any[], getCell: (cellName: string) => any, targetOverride?: number) {
  const produced = entries.reduce((a, e) => a + realized(e), 0);
  const target = targetOverride != null ? targetOverride : entries.reduce((a, e) => a + num(e.planned_target ?? e.target), 0);
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
function computeOeeByCell(entries: any[], cells: any[], goals: any[]) {
  const getCell = (cellName: string) => cells?.find(c => c.name === cellName) || null;
  const byCell: Record<string, any[]> = {};
  entries.forEach((e) => {
    if (!e.cell) return;
    (byCell[e.cell] = byCell[e.cell] || []).push(e);
  });
  return Object.entries(byCell)
    .map(([cell, list]) => {
      const cellGoals = goals.filter((goal) => goal.cell_name === cell);
      const target = cellGoals.length ? cellGoals.reduce((sum, goal) => sum + num(goal.target), 0) : undefined;
      return { cell, ...computeOeeStats(list, getCell, target) };
    })
    .sort((a, b) => a.oee - b.oee);
}
export function renderReportFragmentHtml(type: string, data: any, cellsData?: any[]) {
  if (type === 'daily_production' || type === 'shift_closure') {
    const { entries, goals, fromDate, toDate } = extractProductionBundle(data);
    const total = acc(entries);
    const byCell = buildProductionRows(entries, goals, ['cell']);
    const byShift = buildProductionRows(entries, goals, ['shift']);
    const byUnit = buildProductionRows(entries, goals, []).reduce((map: Map<string, any>, row: any) => {
      const current = map.get(row.unit) || { unit: row.unit, produced: 0, target: 0, downtime: 0 };
      current.produced += row.produced;
      current.target += row.target;
      current.downtime += row.downtime;
      current.attainment = current.target > 0 ? round1((current.produced / current.target) * 100) : 0;
      map.set(row.unit, current);
      return map;
    }, new Map()).values();
    const period = fromDate ? (fromDate === toDate ? fromDate : `${fromDate} a ${toDate}`) : 'período solicitado';

    return `
      <p style="font-family:sans-serif;font-size:12px;color:#64748b;margin-top:0;">Período produtivo: <b>${esc(period)}</b></p>
      <h3 style="font-family:sans-serif;font-size:14px;color:#0f172a;">Quantidade produzida por unidade</h3>
      <table role="presentation" style="width:100%;margin-bottom:18px;"><tr>${metricCards([...byUnit])}</tr></table>
      <h3 style="font-family:sans-serif;font-size:14px;color:#0f172a;">Resumo de qualidade e disponibilidade</h3>
      <table style="border-collapse:collapse;width:100%;margin-bottom:20px;font-family:sans-serif;font-size:13px;">
        <tr style="background:#f8fafc;"><td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;">Registros produtivos</td><td style="padding:10px;border:1px solid #e2e8f0;">${fmt(entries.length)}</td></tr>
        <tr><td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;">Quantidade aprovada</td><td style="padding:10px;border:1px solid #e2e8f0;">${fmt(total.good)}</td></tr>
        <tr style="background:#f8fafc;"><td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;">Refugo</td><td style="padding:10px;border:1px solid #e2e8f0;">${fmt(total.scrap)} (${total.scrapRate}%)</td></tr>
        <tr><td style="padding:10px;border:1px solid #e2e8f0;font-weight:bold;">Minutos de Parada</td><td style="padding:10px;border:1px solid #e2e8f0;">${fmt(total.downtime)} min</td></tr>
      </table>

      <h3 style="font-family:sans-serif;font-size:14px;color:#0f172a;">Produção por Célula</h3>
      ${productionTable(byCell, ['cell'])}
      <h3 style="font-family:sans-serif;font-size:14px;color:#0f172a;margin-top:22px;">Produção por Turno</h3>
      ${productionTable(byShift, ['shift'])}
    `;
  }

  if (type === 'oee') {
    const { entries, goals, fromDate, toDate } = extractProductionBundle(data);
    const getCell = (cellName: string) => cellsData?.find(c => c.name === cellName) || null;
    const target = goals.length ? goals.reduce((sum, goal) => sum + num(goal.target), 0) : undefined;
    const overall = computeOeeStats(entries, getCell, target);
    const byCell = computeOeeByCell(entries, cellsData || [], goals);

    const byCellRows = byCell.map(r => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;font-family:sans-serif;font-weight:bold;">${esc(r.cell)}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;font-weight:bold;color:#0f172a;">${r.oee}%</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;">${progressBar(r.oee, r.oee >= 85 ? '#16a34a' : r.oee >= 60 ? '#f59e0b' : '#dc2626')}</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${r.availability}%</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${r.performance}%</td>
        <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;font-family:sans-serif;">${r.quality}%</td>
      </tr>
    `).join('');

    return `
      <p style="font-family:sans-serif;font-size:12px;color:#64748b;margin-top:0;">Período OEE: <b>${esc(fromDate === toDate ? fromDate : `${fromDate || ''} a ${toDate || ''}`)}</b></p>
      <h3 style="font-family:sans-serif;font-size:14px;color:#0f172a;">Indicadores OEE (Global)</h3>
      <div style="margin-bottom:16px;">${progressBar(overall.oee, overall.oee >= 85 ? '#16a34a' : overall.oee >= 60 ? '#f59e0b' : '#dc2626')}<div style="font-size:22px;font-weight:bold;margin-top:6px;">${overall.oee}%</div></div>
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
            <th style="padding:6px 10px;text-align:left;">Gráfico</th>
            <th style="padding:6px 10px;text-align:right;">Disponibilidade</th>
            <th style="padding:6px 10px;text-align:right;">Performance</th>
            <th style="padding:6px 10px;text-align:right;">Qualidade</th>
          </tr>
        </thead>
        <tbody>
          ${byCellRows || '<tr><td colspan="6" style="padding:15px;text-align:center;color:#64748b;">Nenhum dado OEE registrado para o período.</td></tr>'}
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
    <div style="font-family:Arial,Helvetica,sans-serif;color:#1e293b;max-width:820px;margin:0 auto;border:1px solid #dbe3ea;border-radius:18px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,0.08);background:#ffffff;">
      <div style="background:#00522d;color:#ffffff;padding:18px 22px;display:flex;align-items:center;gap:14px;">
        <img src="${LEO_LOGO_URL}" alt="Leo Madeiras" width="54" height="54" style="border-radius:12px;border:2px solid #ffffff;display:block;" />
        <div>
          <h2 style="margin:0;font-size:20px;letter-spacing:0.2px;color:#ffed00;">Leo Madeiras</h2>
          <p style="margin:4px 0 0 0;font-size:13px;color:#ffffff;">Leo Flow - Relatórios Industriais</p>
        </div>
      </div>
      <div style="padding:24px;background:#ffffff;">
        <h2 style="margin-top:0;font-size:24px;line-height:1.25;color:#0f172a;overflow-wrap:anywhere;">${esc(schedule.name)}</h2>
        <p style="font-size:12px;color:#64748b;margin-bottom:20px;">Período: ${esc(schedule.report_date || schedule.period_mode || 'configurado')} • Gerado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin-bottom:20px;"/>
        
        ${bodyContent}

      </div>
      <div style="background:#f8fafc;padding:15px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;">
        E-mail automático gerado pelo sistema Leo Flow. Favor não responder diretamente a este remetente.
      </div>
    </div>
  `;
}
