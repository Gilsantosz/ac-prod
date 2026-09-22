import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import LeoLogo from '@/components/ui/LeoLogo';
import { getReportImage } from '@/lib/brandLogo';
import { createReportDefinition } from '@/lib/reports/reportDefinition';
import { createReportWorkbook } from '@/lib/reports/reportExcelRenderer';
import { createReportPdfBuffer } from '@/lib/reports/reportPdfRenderer';

const pngBytes = readFileSync(resolve(process.cwd(), 'src/assets/leo-madeiras-logo.jpg'));
const legacyMime = `data:image/jpeg;base64,${pngBytes.toString('base64')}`;
const report = () => createReportDefinition({
  id: 'brand-regression', title: 'Validação de exportação', generatedAt: '2026-09-21T12:00:00Z',
  period: { from: '2026-09-21', to: '2026-09-21' },
  tables: [{ id: 'data', title: 'Produção', sheet: 'data', primary: true,
    columns: [{ key: 'produced', label: 'Produzido', type: 'number' }], rows: [{ produced: 875 }] }],
});

describe('marca original e exportação sem dependência de imagens externas', () => {
  it('identifica o PNG original mesmo com o antigo MIME JPEG', () => {
    const image = getReportImage(legacyMime);
    expect(image.extension).toBe('png');
    expect(image.format).toBe('PNG');
    expect(image.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(Buffer.from(image.dataUrl.split(',')[1], 'base64').equals(pngBytes)).toBe(true);
  });
  it.each([null, '', 'https://example.invalid/logo.jpg', 'data:text/html;base64,PGh0bWw+',
    'data:image/png;base64,bm90LWFuLWltYWdl', 'data:image/png;base64,###'])('recusa uma referência de imagem inválida: %s', (value) => {
    expect(getReportImage(value)).toBeNull();
  });
  it('grava a marca como PNG no XLSX e mantém a proporção', async () => {
    const workbook = await createReportWorkbook(report(), { logoDataUrl: legacyMime, includeCharts: false });
    expect(workbook.model.media).toHaveLength(1);
    expect(workbook.model.media[0].extension).toBe('png');
    const image = workbook.getWorksheet('RESUMO').getImages()[0];
    expect(image.range.ext.width / image.range.ext.height).toBeCloseTo(690 / 685);
    expect((await workbook.xlsx.writeBuffer()).byteLength).toBeGreaterThan(1000);
  });
  it.each([null, 'data:image/png;base64,bm90LWFuLWltYWdl'])('mantém os dados Excel sem marca válida: %s', async (logoDataUrl) => {
    const workbook = await createReportWorkbook(report(), { logoDataUrl, includeCharts: false });
    expect(workbook.model.media).toHaveLength(0);
    expect(workbook.getWorksheet('DADOS').getCell('A2').value).toBe(875);
    expect((await workbook.xlsx.writeBuffer()).byteLength).toBeGreaterThan(1000);
  });
  it('gera PDF mesmo quando uma marca opcional é inválida', async () => {
    const buffer = await createReportPdfBuffer(report(), {
      logoDataUrl: 'data:image/png;base64,bm90LWFuLWltYWdl', includeCharts: false,
    });
    expect(Buffer.from(buffer).subarray(0, 4).toString()).toBe('%PDF');
  });
  it('não deixa o espaço da marca vazio se o navegador rejeitar a imagem', () => {
    render(<LeoLogo />);
    fireEvent.error(screen.getByAltText('Leo Madeiras'));
    expect(screen.getByRole('img', { name: 'Leo Madeiras' }).textContent).toBe('Leo');
    cleanup();
  });
});
