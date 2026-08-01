import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: '00000000-0000-4000-8000-000000000001' } } }),
    },
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
    })),
  },
}));

vi.mock('@/lib/reportBranding', () => ({
  drawBrandedPdfHeader: vi.fn(async (doc, { title, subtitle }) => {
    doc.setFontSize(16);
    doc.text(title, 10, 16);
    doc.setFontSize(8);
    doc.text(subtitle, 10, 22);
    return 30;
  }),
  drawBrandedPdfFooter: vi.fn(async (doc) => {
    const pageCount = doc.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      doc.setFontSize(7);
      doc.text(`Pagina ${page}/${pageCount}`, 180, 290);
    }
  }),
}));

import {
  generateReportCode,
  generateReplacementPdfReport,
} from '@/lib/reports/replacementPdfReportService';

describe('replacementPdfReportService — Geração de Relatórios PDF', () => {
  it('gera um código de relatório único no padrão RPR-YYYYMMDD-XXXXXX', () => {
    const code1 = generateReportCode();
    const code2 = generateReportCode();

    expect(code1).toMatch(/^RPR-\d{8}-\d{6}$/);
    expect(code2).toMatch(/^RPR-\d{8}-\d{6}$/);
    expect(code1).not.toBe(code2);
  });

  it('gera o PDF individual com textos longos e linhas dinamicas sem falhar', async () => {
    const result = await generateReplacementPdfReport({
      reportType: 'individual',
      download: false,
      userName: 'Gil Santos',
      singleOrder: {
        id: '10000000-0000-4000-8000-000000000001',
        replacement_code: 'REP-20260730-7006',
        status: 'requested',
        priority: 'normal',
        created_at: '2026-07-29T23:21:00.000Z',
        rejection_stage: 'drill',
        reason: 'Erro de CNC com detalhamento extenso para validacao do relatorio',
        defect_name: 'Erro de CNC',
        origin_cell_name: 'Corte',
        destination_cell_name: 'Corte',
        lot_code: '26072640',
        order_number: '940002',
        customer_name: 'CLIENTE TESTE AC.PROD',
        environment_name: 'LOTE TESTE 40 - ROTA 2',
        route_steps: ['cut', 'edge', 'drill', 'separation', 'packaging'],
        original_piece: {
          id: '20000000-0000-4000-8000-000000000001',
          piece_code: '09950020',
          piece_name: 'PECA TESTE 20',
          description: 'TRAVESSA 952.5X80X15X80MM BRANCO TX COM DESCRICAO TECNICA EXTENSA',
          material: 'MDF BRANCO ARTICO TX 2F 2750X1840X15MM',
          color: 'BRANCO TX',
          width: 80,
          length: 952.5,
          thickness: 15,
          quantity: 1,
          route_steps: ['cut', 'edge', 'drill', 'separation', 'packaging'],
          created_at: '2026-07-26T18:08:00.000Z',
        },
        replacement_piece: {
          piece_uid: '09950020-REP-R01',
          traceability_code: '09950020-REP-R01',
        },
      },
    });

    expect(result.pdfArrayBuffer).toBeInstanceOf(ArrayBuffer);
    expect(result.pdfArrayBuffer.byteLength).toBeGreaterThan(5_000);
  });
});
