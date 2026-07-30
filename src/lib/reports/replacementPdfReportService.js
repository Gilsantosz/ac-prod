/**
 * AC.Prod MES — Serviço Profissional de Relatórios PDF de Reposição Industrial
 * Layout Responsivo, Sem Sobreposição de Texto, com Medidas e Rastreabilidade Completa.
 */

import { jsPDF } from 'jspdf';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '@/lib/supabaseClient';
import { REPLACEMENT_STATUS_LABELS, REPLACEMENT_PRIORITY_LABELS, formatStageName } from '@/lib/replacementService';
import { formatPieceOrientingHeader } from '@/lib/pieceFormat';
import { drawBrandedPdfHeader, drawBrandedPdfFooter } from '@/lib/reportBranding';

/**
 * Gera um código único do relatório no formato RPR-YYYYMMDD-XXXXXX
 */
export function generateReportCode() {
  const dateStr = format(new Date(), 'yyyyMMdd');
  const randomHex = Math.floor(Math.random() * 899999 + 100000);
  return `RPR-${dateStr}-${randomHex}`;
}

/**
 * Formata as dimensões da peça em mm de maneira legível (Ex: 952.5 × 80 × 15 mm)
 */
function formatDimensions(orig) {
  if (!orig) return '';
  const l = orig.length || orig.comprimento || 0;
  const w = orig.width || orig.largura || 0;
  const t = orig.thickness || orig.espessura || 18;
  if (!l && !w) return '';
  return `${l} × ${w} × ${t} mm`;
}

/**
 * Sanitiza o texto eliminando caracteres unicode não suportados pelo jsPDF (como setas ➔)
 */
function sanitizePdfText(str) {
  if (!str) return '—';
  return String(str)
    .replace(/➔/g, '->')
    .replace(/➜/g, '->')
    .replace(/➝/g, '->')
    .replace(/—/g, '-');
}

/**
 * Compila e faz download do Relatório PDF de Reposições (Individual ou Consolidado)
 */
export async function generateReplacementPdfReport({
  orders = [],
  filters = {},
  reportType = 'filtered', // 'individual' | 'selected' | 'filtered' | 'batch_lot'
  singleOrder = null,
  userName = 'Operador MES'
}) {
  const isIndividual = reportType === 'individual' || !!singleOrder;
  const targetOrders = isIndividual ? [singleOrder] : orders;
  const reportCode = generateReportCode();

  // Inicializar documento PDF
  const doc = new jsPDF({
    orientation: isIndividual ? 'portrait' : 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;

  // 1. Cabeçalho com marca oficial Leo Flow / Leo Madeiras
  let currentY = await drawBrandedPdfHeader(doc, {
    title: isIndividual ? `Ordem de Reposição ${singleOrder?.replacement_code || ''}` : 'Relatório de Produção de Reposições MES',
    subtitle: `Código: ${reportCode} | Emissão: ${format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`,
    summary: [
      { label: 'Tipo', value: isIndividual ? 'Individual' : `Consolidado (${targetOrders.length})` },
      { label: 'Emissor', value: userName },
      { label: 'Status', value: 'Dados Auditados' }
    ]
  });

  currentY += 4;

  if (isIndividual && singleOrder) {
    // ==========================================
    // SEÇÃO INDIVIDUAL: DETALHAMENTO & LINHA DO TEMPO
    // ==========================================
    const order = singleOrder;
    const orig = order.original_piece || {};
    const repl = order.replacement_piece || {};

    const dimsStr = formatDimensions(orig);
    const orientingHeader = sanitizePdfText(formatPieceOrientingHeader(orig));

    // Banner de Orientação Técnica Promob
    doc.setFillColor(239, 246, 255);
    doc.setDrawColor(191, 219, 254);
    doc.roundedRect(margin, currentY, pageWidth - margin * 2, 14, 2, 2, 'FD');

    doc.setTextColor(30, 58, 138);
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.text('IDENTIFICAÇÃO & ORIENTAÇÃO TÉCNICA PROMOB:', margin + 4, currentY + 5);
    doc.setFontSize(7.5);
    doc.setFont(undefined, 'normal');
    doc.text(orientingHeader, margin + 4, currentY + 10, { maxWidth: pageWidth - margin * 2 - 8 });

    currentY += 18;

    // Tabela de Detalhes Técnicos
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('DETALHAMENTO TÉCNICO DA SOLICITAÇÃO', margin, currentY);
    currentY += 4;

    const fields = [
      ['Solicitação:', order.replacement_code || 'N/A', 'Status Atual:', REPLACEMENT_STATUS_LABELS[order.status]?.label || order.status],
      ['Prioridade:', REPLACEMENT_PRIORITY_LABELS[order.priority]?.label || order.priority, 'Data Solicitação:', order.created_at ? format(new Date(order.created_at), 'dd/MM/yyyy HH:mm') : 'N/A'],
      ['Descrição do Produto:', orig.piece_name || orig.description || 'N/A', 'Medidas (C x L x E):', dimsStr || 'N/A'],
      ['Material / Cor:', `${orig.material || 'MDF'} - ${orig.color || 'Padrão'}`, 'Motivo / Defeito:', order.defect_name || order.reason || 'N/A'],
      ['Célula de Origem:', order.origin_cell_name || 'N/A', 'Próxima Célula:', formatStageName(order.destination_cell_name || 'Corte')],
      ['Etapa Reprovada:', formatStageName(order.rejection_stage), 'Lote Geral:', order.lot_code || orig.general_lot_code || 'N/A'],
      ['Lote Cliente / Pedido:', order.order_number || orig.order_number || 'N/A', 'Cliente:', order.customer_name || orig.customer_name || 'N/A'],
      ['Código Peça Original:', orig.piece_code || 'N/A', 'Rastreio Substituta:', repl.traceability_code || repl.piece_uid || `${orig.piece_code || '0000'}-REP-R01`],
      ['Ambiente / Módulo:', order.environment_name || orig.environment_name || 'N/A', 'Rota Reposição:', order.route_steps ? sanitizePdfText(order.route_steps.join(' -> ')) : 'Corte']
    ];

    doc.setFontSize(7.5);
    fields.forEach(([f1, v1, f2, v2]) => {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, currentY, pageWidth - margin * 2, 6, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, currentY + 6, pageWidth - margin, currentY + 6);

      const colHalf = (pageWidth - margin * 2) / 2;

      // Coluna 1
      doc.setFont(undefined, 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text(f1, margin + 2, currentY + 4.2);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(sanitizePdfText(v1), margin + 40, currentY + 4.2, { maxWidth: colHalf - 42 });

      // Coluna 2
      doc.setFont(undefined, 'bold');
      doc.setTextColor(71, 85, 105);
      doc.text(f2, margin + colHalf + 2, currentY + 4.2);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(15, 23, 42);
      doc.text(sanitizePdfText(v2), margin + colHalf + 40, currentY + 4.2, { maxWidth: colHalf - 42 });

      currentY += 6.5;
    });

    currentY += 6;

    // Linha do Tempo de Rastreabilidade (13 Etapas)
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('LINHA DO TEMPO DA RASTREABILIDADE INDUSTRIAL (13 ETAPAS)', margin, currentY);

    currentY += 5;

    const timelineSteps = [
      { step: '1', title: 'Importação da Peça', desc: 'Dados do Promob / PCP persistidos no banco de dados', date: orig.created_at },
      { step: '2', title: 'Produção da Peça Original', desc: `Criação da peça original (${orig.piece_code || 'S/N'})`, date: orig.created_at },
      { step: '3', title: 'Entrada nas Células', desc: 'Entrada na rota produtiva original', date: orig.created_at },
      { step: '4', title: 'Registro de Reprovação', desc: `Peça reprovada na etapa de ${formatStageName(order.rejection_stage)}`, date: order.created_at },
      { step: '5', title: 'Motivo / Defeito Informado', desc: order.defect_name || order.reason || 'Defeito detectado na coleta', date: order.created_at },
      { step: '6', title: 'Solicitação de Reposição', desc: `Gerada ordem de reposição ${order.replacement_code}`, date: order.created_at },
      { step: '7', title: 'Aprovação da Reposição', desc: order.approved_at ? `Aprovada por ${order.approver_name || 'Gestor MES'}` : 'Aguardando Aprovação', date: order.approved_at },
      { step: '8', title: 'Criação da Peça Substituta', desc: `Instância física substituta vinculada com Rastreio: ${repl.traceability_code || 'REP-R01'}`, date: order.approved_at || order.created_at },
      { step: '9', title: 'Emissão da Etiqueta Térmica', desc: 'Impressão da etiqueta 100 x 50 mm Promob', date: order.approved_at },
      { step: '10', title: 'Entrada na Rota Produtiva', desc: 'Reinício de produção na célula de Corte', date: order.approved_at },
      { step: '11', title: 'Passagens pelas Células', desc: 'Acompanhamento de bips via coletor industrial', date: null },
      { step: '12', title: 'Conclusão da Reposição', desc: order.status === 'completed' ? 'Finalizada na Expedição' : 'Em andamento no chão de fábrica', date: order.completed_at },
      { step: '13', title: 'Vinculação Final', desc: 'Peça substituta consolidada com a peça original no lote', date: order.completed_at }
    ];

    // Cabeçalho da Linha do Tempo
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, currentY, pageWidth - margin * 2, 6, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7.5);
    doc.setFont(undefined, 'bold');
    doc.text('#', margin + 2, currentY + 4.5);
    doc.text('Etapa do Ciclo de Vida', margin + 10, currentY + 4.5);
    doc.text('Detalhamento Técnico / Auditoria', margin + 65, currentY + 4.5);
    doc.text('Data & Hora', pageWidth - margin - 35, currentY + 4.5);

    currentY += 6;

    doc.setFontSize(7);
    timelineSteps.forEach((s, idx) => {
      if (currentY > pageHeight - 20) {
        doc.addPage();
        currentY = 20;
      }
      doc.setFillColor(idx % 2 === 0 ? 255 : 248, idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 252);
      doc.rect(margin, currentY, pageWidth - margin * 2, 5.5, 'F');
      doc.setDrawColor(241, 245, 249);
      doc.line(margin, currentY + 5.5, pageWidth - margin, currentY + 5.5);

      doc.setFont(undefined, 'bold');
      doc.setTextColor(2, 132, 199);
      doc.text(s.step, margin + 2, currentY + 4);
      doc.setTextColor(15, 23, 42);
      doc.text(s.title, margin + 10, currentY + 4);

      doc.setFont(undefined, 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(sanitizePdfText(s.desc), margin + 65, currentY + 4, { maxWidth: pageWidth - margin * 2 - 105 });

      doc.text(s.date ? format(new Date(s.date), 'dd/MM/yy HH:mm') : '—', pageWidth - margin - 35, currentY + 4);

      currentY += 5.5;
    });

  } else {
    // ==========================================
    // SEÇÃO CONSOLIDADA: TABELA COMPLETA COM LARGURAS RÍGIDAS E MULTILINHA
    // ==========================================
    const totalCount = targetOrders.length;
    const requestedCount = targetOrders.filter(o => o.status === 'requested').length;
    const approvedCount = targetOrders.filter(o => o.status === 'approved').length;
    const inProdCount = targetOrders.filter(o => o.status === 'in_production').length;
    const completedCount = targetOrders.filter(o => o.status === 'completed').length;

    // Resumo de KPIs em caixa destacada
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, currentY, pageWidth - margin * 2, 11, 2, 2, 'FD');

    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(
      `Total: ${totalCount}  |  Solicitadas: ${requestedCount}  |  Aprovadas: ${approvedCount}  |  Em Produção: ${inProdCount}  |  Concluídas: ${completedCount}`,
      margin + 4,
      currentY + 7
    );

    currentY += 15;

    // Definição das colunas com larguras estritas (Printable width em A4 Landscape = 277mm)
    // Margem: 10mm. Largura útil total = 277mm
    const columns = [
      { name: 'Código Rep.', width: 26 },         // Col 0: 26mm (x: 10)
      { name: 'Status', width: 18 },              // Col 1: 18mm (x: 36)
      { name: 'Data', width: 14 },                // Col 2: 14mm (x: 54)
      { name: 'Descrição do Produto & Medidas', width: 85 }, // Col 3: 85mm (x: 68) -> ESPAÇO AMPLO!
      { name: 'Rastreio Substituta', width: 32 },  // Col 4: 32mm (x: 153)
      { name: 'Lote / Cliente', width: 34 },       // Col 5: 34mm (x: 185)
      { name: 'Defeito', width: 30 },             // Col 6: 30mm (x: 219)
      { name: 'Origem -> Destino', width: 28 }     // Col 7: 28mm (x: 249)
    ];

    // Calcular posições X
    let currentX = margin;
    columns.forEach(col => {
      col.x = currentX;
      currentX += col.width;
    });

    // Cabeçalho da Tabela
    doc.setFillColor(15, 23, 42);
    doc.rect(margin, currentY, pageWidth - margin * 2, 7, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.setFont(undefined, 'bold');

    columns.forEach(col => {
      doc.text(col.name, col.x + 1.5, currentY + 4.8, { maxWidth: col.width - 2 });
    });

    currentY += 7;

    // Linhas da Tabela (Cada linha possui 9mm de altura para acomodar 2 linhas de texto na descrição do produto)
    doc.setFontSize(6.5);

    targetOrders.forEach((o, idx) => {
      const rowHeight = 9.5;

      if (currentY + rowHeight > pageHeight - 15) {
        doc.addPage();
        currentY = 15;

        // Repetir Cabeçalho na Nova Página
        doc.setFillColor(15, 23, 42);
        doc.rect(margin, currentY, pageWidth - margin * 2, 7, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(7);
        doc.setFont(undefined, 'bold');
        columns.forEach(col => {
          doc.text(col.name, col.x + 1.5, currentY + 4.8, { maxWidth: col.width - 2 });
        });
        currentY += 7;
        doc.setFontSize(6.5);
      }

      const orig = o.original_piece || {};
      const repl = o.replacement_piece || {};
      const dims = formatDimensions(orig);
      const pieceName = orig.piece_name || orig.description || orig.piece_code || 'Peça Reposta';

      // Fundo Zebrado
      doc.setFillColor(idx % 2 === 0 ? 255 : 248, idx % 2 === 0 ? 255 : 250, idx % 2 === 0 ? 255 : 252);
      doc.rect(margin, currentY, pageWidth - margin * 2, rowHeight, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, currentY + rowHeight, pageWidth - margin, currentY + rowHeight);

      // Coluna 0: Código Rep.
      doc.setFont(undefined, 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(o.replacement_code || 'N/A', columns[0].x + 1.5, currentY + 4, { maxWidth: columns[0].width - 2 });

      // Coluna 1: Status
      doc.setFont(undefined, 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(REPLACEMENT_STATUS_LABELS[o.status]?.label || o.status, columns[1].x + 1.5, currentY + 4, { maxWidth: columns[1].width - 2 });

      // Coluna 2: Data
      doc.text(o.created_at ? format(new Date(o.created_at), 'dd/MM/yy') : '—', columns[2].x + 1.5, currentY + 4, { maxWidth: columns[2].width - 2 });

      // Coluna 3: DESCRIÇÃO DO PRODUTO & MEDIDAS (2 Linhas completas, sem sobreposição)
      doc.setFont(undefined, 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(sanitizePdfText(pieceName), columns[3].x + 1.5, currentY + 3.8, { maxWidth: columns[3].width - 3 });

      doc.setFont(undefined, 'normal');
      doc.setTextColor(100, 116, 139);
      const subInfo = [dims, orig.material || 'MDF', orig.color || ''].filter(Boolean).join(' - ');
      doc.text(sanitizePdfText(subInfo || 'Medidas não especificadas'), columns[3].x + 1.5, currentY + 7.5, { maxWidth: columns[3].width - 3 });

      // Coluna 4: Rastreio Substituta
      doc.setFont(undefined, 'bold');
      doc.setTextColor(15, 23, 42);
      const traceCode = repl.traceability_code || repl.piece_uid || `${orig.piece_code || '0000'}-REP-R01`;
      doc.text(sanitizePdfText(traceCode), columns[4].x + 1.5, currentY + 5, { maxWidth: columns[4].width - 2 });

      // Coluna 5: Lote / Cliente
      doc.setFont(undefined, 'normal');
      doc.setTextColor(71, 85, 105);
      const lotCustomer = `${o.lot_code || orig.general_lot_code || '—'} / ${o.order_number || orig.order_number || '—'}`;
      doc.text(sanitizePdfText(lotCustomer), columns[5].x + 1.5, currentY + 5, { maxWidth: columns[5].width - 2 });

      // Coluna 6: Motivo / Defeito
      doc.text(sanitizePdfText(o.defect_name || o.reason || '—'), columns[6].x + 1.5, currentY + 5, { maxWidth: columns[6].width - 2 });

      // Coluna 7: Origem -> Destino
      const routeText = `${o.origin_cell_name || 'Origem'} -> ${formatStageName(o.destination_cell_name || 'Corte')}`;
      doc.text(sanitizePdfText(routeText), columns[7].x + 1.5, currentY + 5, { maxWidth: columns[7].width - 2 });

      currentY += rowHeight;
    });
  }

  // Rodapé Institucional
  await drawBrandedPdfFooter(doc);

  // Registrar exportação no banco para auditoria
  try {
    const replacementIds = targetOrders.map(o => o.id).filter(Boolean);
    await supabase.from('replacement_report_exports').insert({
      report_code: reportCode,
      report_type: reportType,
      filters: filters,
      replacement_ids: replacementIds,
      generated_by_name: userName,
      status: 'completed'
    });
  } catch (err) {
    console.error('Erro ao registrar exportação de relatório PDF no banco:', err);
  }

  // Download do arquivo PDF
  const filename = isIndividual
    ? `Reposicao_${singleOrder?.replacement_code || reportCode}.pdf`
    : `Relatorio_Reposicoes_${format(new Date(), 'yyyy-MM-dd')}.pdf`;

  doc.save(filename);
  return { success: true, reportCode, filename };
}
