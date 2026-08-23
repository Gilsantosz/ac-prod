import { describe, expect, it } from 'vitest';
import { createReportDefinition } from './reportDefinition';
import { createReportPdfBuffer } from './reportPdfRenderer';

describe('renderizador PDF compartilhado', () => {
  it('gera um PDF institucional válido sem depender de gráfico visível no DOM', async () => {
    const report = createReportDefinition({
      id: 'production', title: 'Produção', generatedAt: '2026-08-23T12:00:00.000Z',
      period: { from: '2026-08-01', to: '2026-08-02' },
      summary: [{ key: 'produced', label: 'Produção', value: 10, format: 'integer' }],
      tables: [{
        id: 'data', primary: true,
        columns: [{ key: 'date', label: 'Data', type: 'date' }, { key: 'produced', label: 'Produzido', type: 'number' }],
        rows: [{ date: '2026-08-01', produced: 10 }],
      }],
    });
    const buffer = await createReportPdfBuffer(report, { includeCharts: false, logoDataUrl: null });
    const signature = new TextDecoder().decode(new Uint8Array(buffer).slice(0, 5));
    expect(signature).toBe('%PDF-');
  });
});
