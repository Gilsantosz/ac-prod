export const PRODUCTION_SCAN_LENGTH = 8;
export const PRODUCTION_SCAN_PATTERN = /^[0-9]{8}$/;

const NON_ASCII_DIGIT = /[^0-9]/g;
const UNSUPPORTED_SCAN_CHARACTER = /[^0-9\s\r\n\t]/;

/**
 * Interpreta a leitura física sem converter para número, preservando zeros à esquerda.
 * Prefixos, sufixos e caracteres de controle do coletor são ignorados. O
 * contrato produtivo considera os dígitos ASCII de 0 a 9 e exige exatamente 8.
 */
export function parseProductionScanCode(rawValue) {
  const raw = String(rawValue ?? '');
  const digits = raw.replace(NON_ASCII_DIGIT, '');
  const compact = digits;
  const hasUnsupportedCharacters = UNSUPPORTED_SCAN_CHARACTER.test(raw);
  const overflow = digits.length > PRODUCTION_SCAN_LENGTH;
  const value = digits.slice(0, PRODUCTION_SCAN_LENGTH);
  const complete = digits.length === PRODUCTION_SCAN_LENGTH;
  const valid = complete && !overflow && PRODUCTION_SCAN_PATTERN.test(value);

  return {
    raw,
    compact,
    value,
    digitCount: digits.length,
    remaining: Math.max(PRODUCTION_SCAN_LENGTH - digits.length, 0),
    complete,
    overflow,
    hasUnsupportedCharacters,
    valid,
  };
}

export function normalizeProductionScanCode(rawValue) {
  const parsed = parseProductionScanCode(rawValue);
  return parsed.valid ? parsed.value : '';
}

export function getProductionScanCodeError(rawValue) {
  const parsed = parseProductionScanCode(rawValue);
  if (parsed.digitCount === 0) return 'Leia uma numeração produtiva contendo exatamente 8 dígitos.';
  if (parsed.overflow) return 'A numeração excedeu o limite de 8 dígitos e não foi registrada.';
  if (!parsed.complete) return `Aguardando ${parsed.remaining} dígito(s) para completar a leitura.`;
  return null;
}
