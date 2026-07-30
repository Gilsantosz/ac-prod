import { describe, it, expect } from 'vitest';
import { generateReportCode } from '@/lib/reports/replacementPdfReportService';

describe('replacementPdfReportService — Geração de Relatórios PDF', () => {
  it('gera um código de relatório único no padrão RPR-YYYYMMDD-XXXXXX', () => {
    const code1 = generateReportCode();
    const code2 = generateReportCode();

    expect(code1).toMatch(/^RPR-\d{8}-\d{6}$/);
    expect(code2).toMatch(/^RPR-\d{8}-\d{6}$/);
    expect(code1).not.toBe(code2);
  });
});
