import { describe, expect, it } from 'vitest';
import {
  getProductionScanCodeError,
  normalizeProductionScanCode,
  parseProductionScanCode,
  PRODUCTION_SCAN_LENGTH,
} from '@/lib/productionScanCode';

describe('productionScanCode', () => {
  it('preserva zero à esquerda e aceita exatamente 8 dígitos', () => {
    const parsed = parseProductionScanCode('09950001');

    expect(PRODUCTION_SCAN_LENGTH).toBe(8);
    expect(parsed.valid).toBe(true);
    expect(parsed.value).toBe('09950001');
    expect(normalizeProductionScanCode('09950001')).toBe('09950001');
  });

  it('ignora somente caracteres de controle comuns enviados pelo coletor', () => {
    const parsed = parseProductionScanCode(' 09950001\r\n\t');

    expect(parsed.valid).toBe(true);
    expect(parsed.value).toBe('09950001');
  });

  it('não aceita leitura incompleta', () => {
    const parsed = parseProductionScanCode('0995000');

    expect(parsed.valid).toBe(false);
    expect(parsed.remaining).toBe(1);
    expect(getProductionScanCodeError('0995000')).toMatch(/1 dígito/);
  });

  it('não trunca silenciosamente numeração maior que 8 dígitos', () => {
    const parsed = parseProductionScanCode('099500011');

    expect(parsed.valid).toBe(false);
    expect(parsed.overflow).toBe(true);
    expect(normalizeProductionScanCode('099500011')).toBe('');
    expect(getProductionScanCodeError('099500011')).toMatch(/excedeu o limite/);
  });

  it('bloqueia letras e outros caracteres não produtivos', () => {
    const parsed = parseProductionScanCode('ABC09950001');

    expect(parsed.valid).toBe(false);
    expect(parsed.hasUnsupportedCharacters).toBe(true);
    expect(getProductionScanCodeError('ABC09950001')).toMatch(/somente dígitos/);
  });
});
