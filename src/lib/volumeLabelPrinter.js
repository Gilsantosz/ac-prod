function appendTextLine(documentRef, parent, label, value) {
  const line = documentRef.createElement('p');
  const strong = documentRef.createElement('strong');
  strong.textContent = label;
  line.append(strong, documentRef.createTextNode(` ${String(value ?? '')}`));
  parent.appendChild(line);
}

/**
 * Abre uma etiqueta de volume sem interpolar dados operacionais em HTML.
 * Todo valor vindo do banco é inserido com textContent/createTextNode.
 */
export function printVolumeLabel({
  volumeCode,
  lotCode,
  customerName,
  orderCode = null,
  status = null,
  generatedAt,
  variant = 'compact',
  closeAfterPrint = false,
}) {
  const features = variant === 'detailed' ? 'width=460,height=640' : 'width=400,height=600';
  const printWindow = window.open('about:blank', '_blank', features);
  if (!printWindow) return false;

  // O documento de impressão não precisa manter referência à aplicação.
  printWindow.opener = null;

  const documentRef = printWindow.document;
  const title = documentRef.createElement('title');
  title.textContent = 'Etiqueta de Volume';

  const style = documentRef.createElement('style');
  style.textContent = variant === 'detailed'
    ? `
      body { font-family: 'Courier New', monospace; padding: 20px; text-align: center; }
      .label-box { border: 3px solid #000; padding: 20px; width: 380px; margin: 0 auto; border-radius: 8px; }
      .title { font-size: 20px; font-weight: bold; margin-bottom: 10px; text-transform: uppercase; }
      .code { font-size: 26px; font-weight: bold; margin: 15px 0; background: #000; color: #fff; padding: 5px; }
      .meta { text-align: left; font-size: 13px; line-height: 1.6; }
      .footer { font-size: 10px; margin-top: 20px; color: #555; }
    `
    : `
      body { font-family: monospace; padding: 20px; text-align: center; }
      .barcode { font-size: 24px; font-weight: bold; margin: 20px 0; letter-spacing: 5px; }
      .meta { border-top: 1px dashed #000; padding-top: 10px; text-align: left; font-size: 12px; }
    `;

  documentRef.head.replaceChildren(title, style);
  documentRef.body.replaceChildren();

  if (variant === 'detailed') {
    const labelBox = documentRef.createElement('div');
    labelBox.className = 'label-box';

    const heading = documentRef.createElement('div');
    heading.className = 'title';
    heading.textContent = 'Leo Flow — Volume';

    const code = documentRef.createElement('div');
    code.className = 'code';
    code.textContent = String(volumeCode ?? '');

    const meta = documentRef.createElement('div');
    meta.className = 'meta';
    appendTextLine(documentRef, meta, 'LOTE:', lotCode);
    appendTextLine(documentRef, meta, 'CLIENTE:', customerName || 'Sob Medida');
    appendTextLine(documentRef, meta, 'PEDIDO:', orderCode);
    appendTextLine(documentRef, meta, 'GERADO EM:', generatedAt);

    const footer = documentRef.createElement('div');
    footer.className = 'footer';
    footer.textContent = 'Leo Flow Rastreabilidade de Chão de Fábrica';

    labelBox.append(heading, code, meta, footer);
    documentRef.body.appendChild(labelBox);
  } else {
    const appName = documentRef.createElement('h2');
    appName.textContent = 'AC.Prod MES';
    const heading = documentRef.createElement('h3');
    heading.textContent = 'VOLUME DE EMBALAGEM';
    const code = documentRef.createElement('div');
    code.className = 'barcode';
    code.textContent = String(volumeCode ?? '');
    const meta = documentRef.createElement('div');
    meta.className = 'meta';
    appendTextLine(documentRef, meta, 'Carga / Lote Geral:', lotCode);
    appendTextLine(documentRef, meta, 'Destinatário:', customerName);
    appendTextLine(documentRef, meta, 'Status:', status);
    appendTextLine(documentRef, meta, 'Data:', generatedAt);
    documentRef.body.append(appName, heading, code, meta);
  }

  const finishPrint = () => {
    printWindow.focus();
    printWindow.print();
    if (closeAfterPrint) printWindow.close();
  };
  window.setTimeout(finishPrint, 50);
  return true;
}
