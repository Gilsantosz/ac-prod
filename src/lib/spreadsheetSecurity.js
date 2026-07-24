export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_WORKSHEET_ROWS = 50_000;
export const MAX_WORKSHEET_COLUMNS = 256;

function extensionOf(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] || '';
}

export function assertSafeImportFile(file, allowedExtensions = []) {
  if (!file) throw new Error('Arquivo não informado.');
  const extension = extensionOf(file.name);
  const allowed = allowedExtensions.map((item) => String(item).replace(/^\./, '').toLowerCase());
  if (!extension || (allowed.length && !allowed.includes(extension))) {
    throw new Error(`Formato .${extension || 'desconhecido'} não permitido para esta importação.`);
  }
  if (Number(file.size || 0) > MAX_IMPORT_FILE_BYTES) {
    throw new Error('O arquivo excede o limite de segurança de 20 MB.');
  }
  return extension;
}

export function assertWorksheetBounds(worksheet, xlsxUtils) {
  if (!worksheet?.['!ref']) return { rows: 0, columns: 0 };
  if (!xlsxUtils?.decode_range) throw new Error('Leitor de planilha indisponível.');
  const range = xlsxUtils.decode_range(worksheet['!ref']);
  const rows = range.e.r - range.s.r + 1;
  const columns = range.e.c - range.s.c + 1;
  if (rows > MAX_WORKSHEET_ROWS) {
    throw new Error(`A planilha excede o limite de ${MAX_WORKSHEET_ROWS.toLocaleString('pt-BR')} linhas.`);
  }
  if (columns > MAX_WORKSHEET_COLUMNS) {
    throw new Error(`A planilha excede o limite de ${MAX_WORKSHEET_COLUMNS} colunas.`);
  }
  return { rows, columns };
}

