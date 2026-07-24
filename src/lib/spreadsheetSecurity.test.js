import { describe, expect, it } from 'vitest';
import {
  assertSafeImportFile,
  assertWorksheetBounds,
  MAX_IMPORT_FILE_BYTES,
} from './spreadsheetSecurity';

describe('spreadsheetSecurity', () => {
  it('aceita arquivo permitido dentro do limite', () => {
    expect(assertSafeImportFile({ name: 'pcp.xlsx', size: 1024 }, ['xlsx', 'csv'])).toBe('xlsx');
  });

  it('bloqueia extensão e tamanho não permitidos', () => {
    expect(() => assertSafeImportFile({ name: 'pcp.exe', size: 100 }, ['xlsx'])).toThrow(/não permitido/);
    expect(() => assertSafeImportFile({ name: 'pcp.xlsx', size: MAX_IMPORT_FILE_BYTES + 1 }, ['xlsx'])).toThrow(/20 MB/);
  });

  it('bloqueia planilhas com dimensões abusivas', () => {
    const utils = { decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 50_000, c: 2 } }) };
    expect(() => assertWorksheetBounds({ '!ref': 'A1:C50001' }, utils)).toThrow(/50.000 linhas/);
  });
});

