import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

// Exigências da Tabela de Ocorrências
const COLS = [
  { key: 'shift', label: 'Turno' },
  { key: 'cell', label: 'Célula' },
  { key: 'reason', label: 'Motivo' },
  { key: 'downtime', label: 'Minutos' },
  { key: 'operator', label: 'Operador' },
];

export async function exportOccurrencesPdf(occurrences, dateStr, filterCell, filterShift, chartEl, filename = 'gargalos.pdf') {
  // Filtra as ocorrências conforme os filtros ativos
  const filtered = occurrences.filter((o) => {
    if (o.date !== dateStr) return false;
    if (filterCell !== 'all' && o.cell !== filterCell) return false;
    if (filterShift !== 'all' && o.shift !== filterShift) return false;
    return true;
  });

  const doc = new jsPDF();
  const margin = 14;
  let y = 18;

  const [yyyy, mm, dd] = dateStr.split('-');
  const niceDate = `${dd}/${mm}/${yyyy}`;
  const cellLabel = filterCell === 'all' ? 'Todas as células' : filterCell;
  const shiftLabel = filterShift === 'all' ? 'Todos os turnos' : filterShift;

  // 1. Cabeçalho Principal (Padrão Visual das outras páginas)
  doc.setFontSize(18);
  doc.setTextColor(20);
  doc.text('Relatório Diário de Ocorrências e Gargalos', margin, y);
  y += 7;

  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(`Data: ${niceDate}  ·  Célula: ${cellLabel}  ·  Turno: ${shiftLabel}`, margin, y);
  y += 5;
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, margin, y);
  y += 10;

  // 2. KPIs de Parada
  const totalDowntime = filtered.reduce((s, o) => s + (Number(o.downtime) || 0), 0);
  doc.setTextColor(20);
  doc.setFontSize(11);
  doc.text(
    `Total de paradas: ${filtered.length}   ·   Tempo total parado: ${totalDowntime} min`,
    margin, y
  );
  y += 10;

  // 3. Captura do Gráfico de Pareto (html2canvas)
  if (chartEl && filtered.length > 0) {
    try {
      const canvas = await html2canvas(chartEl, { scale: 2, backgroundColor: '#ffffff', logging: false });
      const img = canvas.toDataURL('image/png');
      const pageW = 182;
      const imgH = (canvas.height * pageW) / canvas.width;
      
      doc.addImage(img, 'PNG', margin, y, pageW, imgH);
      y += imgH + 10;
      
      if (y > 250) {
        doc.addPage();
        y = 20;
      }
    } catch (err) {
      console.error('Falha ao renderizar imagem do gráfico de Pareto:', err);
    }
  }

  // 4. Tabela de Ocorrências
  doc.setFontSize(13);
  doc.text('Detalhamento das Ocorrências', margin, y);
  y += 7;

  doc.setFillColor(30, 30, 30);
  doc.setTextColor(255);
  doc.setFontSize(8);
  
  // Posições X das colunas
  const xs = [14, 40, 70, 140, 160];
  
  doc.rect(margin, y - 5, 182, 7, 'F');
  COLS.forEach((c, i) => doc.text(c.label, xs[i], y));
  y += 7;

  doc.setTextColor(40);
  doc.setFontSize(9);

  if (filtered.length === 0) {
    doc.setTextColor(110);
    doc.text('Nenhuma parada registrada para os filtros selecionados neste dia.', margin + 2, y);
  } else {
    filtered.forEach((o) => {
      if (y > 280) {
        doc.addPage();
        y = 20;
        
        // Repete o cabeçalho da tabela na nova página
        doc.setFillColor(30, 30, 30);
        doc.setTextColor(255);
        doc.setFontSize(8);
        doc.rect(margin, y - 5, 182, 7, 'F');
        COLS.forEach((c, i) => doc.text(c.label, xs[i], y));
        y += 7;
        doc.setTextColor(40);
        doc.setFontSize(9);
      }

      doc.text(String(o.shift || '-'), xs[0], y);
      doc.text(String(o.cell || '-'), xs[1], y);
      doc.text(String(o.reason || '-').slice(0, 35), xs[2], y);
      doc.text(`${o.downtime || 0} min`, xs[3], y);
      doc.text(String(o.operator || '-').slice(0, 20), xs[4], y);
      y += 6;
    });
  }

  doc.save(filename);
}