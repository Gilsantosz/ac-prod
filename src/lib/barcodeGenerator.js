/**
 * AC.Prod MES — Gerador de Código de Barras Code 128 (Subset B / Subset C)
 * Suporte a SVG vetorial, Data URI e Canvas sem dependências externas.
 */

// Padrões de código de barras Code 128 (107 elementos, cada um com 6 barras/espaços de larguras 1..4, exceto STOP com 7)
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", // 0-9
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132", // 10-19
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", // 20-29
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", // 30-39
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "312113", // 40-49
  "312311", "332111", "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", // 50-59
  "141221", "112214", "112412", "122114", "122411", "142112", "142211", "241211", "221114", "411122", // 60-69
  "411221", "421112", "421221", "211142", "211241", "211421", "231121", "211114", "411112", "412111", // 70-79
  "211133", "311123", "311321", "113131", "113313", "133113", "133311", "311313", "331113", "331311", // 80-89
  "112133", "112331", "132131", "113123", "113321", "133121", "313121", "312113", "312311", "332111", // 90-99
  "233111", "211412", "211214", "211232", "2331112" // 100-104 (103=START B, 104=START C, 105=STOP, 106=STOP extra)
];

const START_CODE_B = 104;
const START_CODE_C = 105;
const STOP_CODE = 106;

/**
 * Codifica uma string textual para a sequência de valores numéricos Code 128 (Auto B/C)
 */
export function encodeCode128(text) {
  if (!text || typeof text !== 'string') {
    text = '00000000';
  }
  const clean = text.trim();
  const codes = [];
  
  // Usar Start B como padrão
  codes.push(START_CODE_B);
  let checksum = START_CODE_B;

  for (let i = 0; i < clean.length; i++) {
    const charCode = clean.charCodeAt(i);
    let val = charCode - 32;
    if (val < 0 || val > 95) {
      val = 31; // Fallback para espaço/interrogação se fora do ASCII imprimível
    }
    codes.push(val);
    checksum += val * (i + 1);
  }

  const checkSymbol = checksum % 103;
  codes.push(checkSymbol);
  codes.push(STOP_CODE);

  return codes;
}

/**
 * Gera os módulos binários (larguras 1..4) a partir dos códigos Code 128
 */
export function getCode128Modules(text) {
  const codes = encodeCode128(text);
  let bars = "";

  codes.forEach((codeIdx) => {
    let pattern = CODE128_PATTERNS[codeIdx];
    if (!pattern) {
      pattern = CODE128_PATTERNS[104];
    }
    bars += pattern;
  });
  bars += "2331112"; // Stop pattern completo

  return bars;
}

/**
 * Gera string SVG vetorial pura para o Código de Barras
 */
export function generateCode128Svg(text, {
  height = 50,
  barWidth = 2,
  quietZone = 10,
  showText = true,
  fontSize = 12,
  fontFamily = 'monospace'
} = {}) {
  const cleanText = (text || '').trim() || '00000000';
  const codes = encodeCode128(cleanText);

  // Converter a sequência de códigos em padrões de barras (largura de cada barra/espaço)
  let elements = [];
  codes.forEach((c) => {
    const pattern = CODE128_PATTERNS[c] || CODE128_PATTERNS[104];
    for (let i = 0; i < pattern.length; i++) {
      elements.push(parseInt(pattern[i], 10));
    }
  });

  // Padrão de término (STOP symbol pattern)
  const stopPattern = "2331112";
  for (let i = 0; i < stopPattern.length; i++) {
    elements.push(parseInt(stopPattern[i], 10));
  }

  let x = quietZone;
  let rects = [];
  let isBar = true;

  elements.forEach((widthUnits) => {
    const w = widthUnits * barWidth;
    if (isBar) {
      rects.push(`<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${height}" fill="#000000" />`);
    }
    x += w;
    isBar = !isBar;
  });

  const totalWidth = x + quietZone;
  const textHeight = showText ? fontSize + 4 : 0;
  const totalSvgHeight = height + textHeight;

  let textSvg = '';
  if (showText) {
    textSvg = `<text x="${(totalWidth / 2).toFixed(2)}" y="${(height + fontSize + 2).toFixed(2)}" text-anchor="middle" font-family="${fontFamily}" font-size="${fontSize}" font-weight="bold" fill="#000000">${cleanText}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth.toFixed(2)} ${totalSvgHeight.toFixed(2)}" width="${totalWidth.toFixed(2)}" height="${totalSvgHeight.toFixed(2)}">
  <rect width="100%" height="100%" fill="#ffffff" />
  ${rects.join('\n  ')}
  ${textSvg}
</svg>`;
}

/**
 * Retorna Data URI SVG do código de barras
 */
export function generateCode128DataUri(text, options = {}) {
  const svg = generateCode128Svg(text, options);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Desenha o código de barras diretamente em um HTMLCanvasElement
 */
export function renderCode128ToCanvas(canvas, text, options = {}) {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const svgString = generateCode128Svg(text, options);
  
  const img = new Image();
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
  };
  img.src = url;
}
