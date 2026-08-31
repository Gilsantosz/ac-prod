export const PRODUCTION_SCAN_LENGTH = 8;
export const PRODUCTION_SCAN_PATTERN = /^\d{8}$/;

const COMMON_SCANNER_WHITESPACE = /[\s\r\n\t]/g;
const UNSUPPORTED_SCAN_CHARACTER = /[^0-9\s\r\n\t]/;

/**
 * Interpreta a leitura física sem converter para número, preservando zeros à esquerda.
 * Caracteres de controle comuns do coletor (Enter/Tab/espaço) são ignorados.
 */
export function parseProductionScanCode(rawValue) {
  const raw = String(rawValue ?? '');
  const compact = raw.replace(COMMON_SCANNER_WHITESPACE, '');
  const digits = compact.replace(/\D/g, '');
  const hasUnsupportedCharacters = UNSUPPORTED_SCAN_CHARACTER.test(raw);
  const overflow = digits.length > PRODUCTION_SCAN_LENGTH;
  const value = digits.slice(0, PRODUCTION_SCAN_LENGTH);
  const complete = digits.length === PRODUCTION_SCAN_LENGTH;
  const valid = complete && !overflow && !hasUnsupportedCharacters && PRODUCTION_SCAN_PATTERN.test(value);

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
  if (!parsed.raw.trim()) return 'Leia uma numeração produtiva de 8 dígitos.';
  if (parsed.hasUnsupportedCharacters) return 'A numeração produtiva aceita somente dígitos de 0 a 9.';
  if (parsed.overflow) return 'A numeração excedeu o limite de 8 dígitos e não foi registrada.';
  if (!parsed.complete) return `Aguardando ${parsed.remaining} dígito(s) para completar a leitura.`;
  return null;
}
