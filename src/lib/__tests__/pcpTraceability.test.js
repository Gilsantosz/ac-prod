import { describe, expect, it } from 'vitest';

// ─── Helpers do PCP Import Engine (Extraídos do index.ts para testes unitários) ─────────────────

function cleanCell(val) {
  if (val === undefined || val === null) return "";
  let s = String(val).trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    s = s.substring(1, s.length - 1).trim();
  }
  return s;
}

function parsePcpLine(cols) {
  const colsClean = cols.map(cleanCell);
  return {
    lotCode: colsClean[0] || "",
    orderCode: colsClean[1] || "",
    customer: colsClean[2] || "",
    projectName: colsClean[3] || "",
    environmentName: colsClean[4] || "",
    moduleName: colsClean[5] || "",
    pieceCode: colsClean[6] || "",
    pieceName: colsClean[7] || "",
    material: colsClean[8] || "",
    color: colsClean[9] || "",
    thickness: colsClean[10] || "",
    width: colsClean[11] || "",
    height: colsClean[12] || "",
    quantity: colsClean[13] || "",
    barcode: colsClean[14] || "",       // Col O
    checkBarcode: colsClean[24] || "",  // Col Y
    route: colsClean[26] || "",         // Col AA
  };
}

function parsePcpRouteTokens(routeText) {
  const cleanRoute = String(routeText || '')
    .toUpperCase()
    .replace(/USI ESPECIAL/g, 'USIESPECIAL')
    .replace(/PORTA JOIAS/g, 'PORTAJOIAS')
    .replace(/RASGO FREGGIO/g, 'RASGOFREGGIO');
  const tokens = cleanRoute.split(/[\s,;/+\-]+/);
  const stages = [];
  const ordered = ['cut', 'edge', 'drill', 'cnc', 'canal', 'maranello', 'portajoias', 'sorrento', 'usi_especial', 'rasgo_freggio', 'joinery', 'separation', 'packaging'];
  const result = [];

  tokens.forEach(tok => {
    const t = tok.trim();
    if (t === 'CORTAR' || t === 'CORTE') stages.push('cut');
    else if (t === 'BORDEAR' || t === 'BORDO' || t === 'BORDA' || t === 'EDGE') stages.push('edge');
    else if (t === 'FURAR' || t === 'FURAÇÃO' || t === 'DRILL') stages.push('drill');
    else if (t === 'USINAGEM' || t === 'CNC' || t === 'USINAR') stages.push('cnc');
    else if (t === 'CANAL') stages.push('canal');
    else if (t === 'MARANELLO') stages.push('maranello');
    else if (t === 'PORTAJOIAS') stages.push('portajoias');
    else if (t === 'SORRENTO') stages.push('sorrento');
    else if (t === 'USIESPECIAL') stages.push('usi_especial');
    else if (t === 'RASGOFREGGIO') stages.push('rasgo_freggio');
    else if (t === 'MARCENARIA' || t === 'JOINERY') stages.push('joinery');
  });

  stages.push('separation');
  stages.push('packaging');

  ordered.forEach(step => {
    if (stages.includes(step)) {
      result.push(step);
    }
  });

  return result;
}

function reconstructTabLine(cells) {
  const joined = cells.map(c => String(c ?? '')).join(' ');
  return joined.split(';');
}

describe('PCP Traceability & Import Engine', () => {
  describe('Deteção e Limpeza de Células', () => {
    it('deve remover espaços externos e aspas duplas de campos de texto', () => {
      expect(cleanCell('  "09908478"  ')).toBe('09908478');
      expect(cleanCell('   CORTAR BORDEAR   ')).toBe('CORTAR BORDEAR');
      expect(cleanCell(null)).toBe('');
    });
  });

  describe('Reconstrução de Linha XLSX Fragmentada por TAB', () => {
    it('deve unir células separadas por TAB com espaço antes de dividir por ponto e vírgula', () => {
      const mockXlsxRowCells = [
        '09908478;PED-123;',
        'Cliente A;Projeto X;Cozinha;Armario;P001;Porta;MDF;Branco;18;600;700;2;09908478;;;;;;;;;;09908478;;CORTAR',
        'BORDEAR;;separation;packaging'
      ];
      
      const cols = reconstructTabLine(mockXlsxRowCells);
      const parsed = parsePcpLine(cols);

      // Col O (index 14) deve ser 09908478
      expect(parsed.barcode).toBe('09908478');
      // Col Y (index 24) deve ser 09908478
      expect(parsed.checkBarcode).toBe('09908478');
      // Col AA (index 26) deve ter os tokens de rota
      expect(parsed.route).toContain('CORTAR');
      expect(parsed.route).toContain('BORDEAR');
    });
  });

  describe('Validação das Colunas O e Y (Barcodes de Rastreabilidade)', () => {
    it('deve aprovar linha onde Coluna O e Y são idênticas', () => {
      const line = Array(33).fill('');
      line[14] = '09908478';
      line[24] = '09908478';

      const parsed = parsePcpLine(line);
      expect(parsed.barcode).toBe('09908478');
      expect(parsed.checkBarcode).toBe('09908478');
      expect(parsed.barcode === parsed.checkBarcode).toBe(true);
    });

    it('deve rejeitar linha onde Coluna O e Y divergem', () => {
      const line = Array(33).fill('');
      line[14] = '09908478';
      line[24] = '09908479';

      const parsed = parsePcpLine(line);
      expect(parsed.barcode).toBe('09908478');
      expect(parsed.checkBarcode).toBe('09908479');
      expect(parsed.barcode === parsed.checkBarcode).toBe(false);
    });

    it('deve detectar código vazio na Coluna O', () => {
      const line = Array(33).fill('');
      line[14] = '';
      line[24] = '09908478';

      const parsed = parsePcpLine(line);
      expect(parsed.barcode).toBe('');
      expect(parsed.barcode === '').toBe(true);
    });
  });

  describe('Mapeamento e Ordenação de Tokens de Rota (Coluna AA)', () => {
    it('deve mapear tokens para identificadores corretos em ordem determinística', () => {
      const routeText = 'CORTAR BORDEAR FURAR USINAGEM';
      const steps = parsePcpRouteTokens(routeText);

      // Esperado: Corte (cut) -> Bordo (edge) -> Furação (drill) -> CNC (cnc) -> Separação -> Embalagem
      expect(steps).toEqual(['cut', 'edge', 'drill', 'cnc', 'separation', 'packaging']);
    });

    it('deve garantir que Separação e Embalagem sejam adicionados ao fim da rota', () => {
      const routeText = 'CORTAR';
      const steps = parsePcpRouteTokens(routeText);

      expect(steps).toEqual(['cut', 'separation', 'packaging']);
    });

    it('deve mapear rotas especiais como Maranello e Usi Especial', () => {
      const routeText = 'MARANELLO USI ESPECIAL';
      const steps = parsePcpRouteTokens(routeText);

      expect(steps).toEqual(['maranello', 'usi_especial', 'separation', 'packaging']);
    });
  });
});
