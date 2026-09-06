import { describe, expect, it } from 'vitest';
import {
  getProductionScanCodeError,
  normalizeProductionScanCode,
  parseProductionScanCode,
  PRODUCTION_SCAN_LENGTH,
} from '@/lib/productionScanCode';

describe('productionScanCode', () => {
  it('preserva zero à esquerda e aceita exatamente 8 dígitos', () => {
    const parsed = parseProductionScanCode('09906655');

    expect(PRODUCTION_SCAN_LENGTH).toBe(8);
    expect(parsed.valid).toBe(true);
    expect(parsed.value).toBe('09906655');
    expect(normalizeProductionScanCode('09906655')).toBe('09906655');
  });

  it.each(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])(
    'aceita qualquer numeração iniciada por %s quando contém 8 dígitos',
    (firstDigit) => {
      const code = `${firstDigit}1234567`;
      expect(normalizeProductionScanCode(code)).toBe(code);
    },
  );

  it('ignora prefixos, sufixos e caracteres de controle enviados pelo coletor', () => {
    const parsed = parseProductionScanCode('\u0002ABC-09906655\u001d\u0003');

    expect(parsed.valid).toBe(true);
    expect(parsed.value).toBe('09906655');
    expect(parsed.hasUnsupportedCharacters).toBe(true);
    expect(getProductionScanCodeError('\u0002ABC-09906655\u001d\u0003')).toBeNull();
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

  it('não aceita texto sem oito dígitos', () => {
    const parsed = parseProductionScanCode('ABC');

    expect(parsed.valid).toBe(false);
    expect(getProductionScanCodeError('ABC')).toMatch(/exatamente 8 dígitos/);
  });
});
