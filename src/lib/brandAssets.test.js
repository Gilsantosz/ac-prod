import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizeReportImage } from './brandAssets';
import { downloadBlob } from './reportBranding';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('marca institucional e download', () => {
  it('preserva o arquivo original e corrige a MIME JPEG legada pelos bytes PNG', async () => {
    const png = await readFile(resolve(process.cwd(), 'src/assets/leo-madeiras-logo.png'));
    const legacy = await readFile(resolve(process.cwd(), 'src/assets/leo-madeiras-logo.jpg'));
    expect(png.equals(legacy)).toBe(true);
    const result = normalizeReportImage(`data:image/jpeg;base64,${png.toString('base64')}`);
    expect(result.extension).toBe('png');
    expect(result.pdfFormat).toBe('PNG');
    expect(Buffer.from(result.dataUrl.split(',')[1], 'base64').equals(png)).toBe(true);
  });

  it('não incorpora HTML, placeholders, Base64 inválido ou PNG truncado', async () => {
    const png = await readFile(resolve(process.cwd(), 'src/assets/leo-madeiras-logo.png'));
    for (const value of [null, '', 'https://example.invalid/logo.png',
      'data:text/html;base64,PGgxPkVycm88L2gxPg==',
      'data:image/png;base64,PGgxPkVycm88L2gxPg==',
      'data:image/png;base64,%%%%',
      `data:image/png;base64,${png.subarray(0, 50).toString('base64')}`]) {
      expect(normalizeReportImage(value)).toBeNull();
    }
  });

  it('não revoga o Blob antes que o navegador tenha iniciado o download', () => {
    vi.useFakeTimers();
    const create = vi.fn(() => 'blob:branding-test');
    const revoke = vi.fn();
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadBlob(new Blob(['test']), 'teste.xlsx');
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    expect(document.querySelector('a[download="teste.xlsx"]')).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(revoke).toHaveBeenCalledWith('blob:branding-test');
  });
});
