import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getPrintHistoryMock,
  recordPrintMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  getPrintHistoryMock: vi.fn(),
  recordPrintMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, ...props }) => <section {...props}>{children}</section>,
  DialogHeader: ({ children, ...props }) => <header {...props}>{children}</header>,
  DialogTitle: ({ children, ...props }) => <h2 {...props}>{children}</h2>,
  DialogDescription: ({ children, ...props }) => <p {...props}>{children}</p>,
  DialogFooter: ({ children, ...props }) => <footer {...props}>{children}</footer>,
}));

vi.mock('@/lib/replacementLabelService', () => ({
  validateReplacementLabelData: vi.fn(() => ({ isValid: true, issues: [] })),
  recordReplacementLabelPrint: recordPrintMock,
  getReplacementLabelPrintHistory: getPrintHistoryMock,
  buildReplacementTraceCode: vi.fn(() => '09950020-REP-R01'),
}));

vi.mock('@/lib/barcodeGenerator', () => ({
  generateCode128Svg: vi.fn(() => '<svg aria-label="codigo de barras"></svg>'),
}));

vi.mock('@/lib/reports/replacementPdfReportService', () => ({
  generateReplacementPdfReport: vi.fn(),
}));

vi.mock('@/lib/pieceFormat', () => ({
  formatPieceFullContext: vi.fn(() => ({
    header: 'PECA TESTE 20 - CORTE + BORDA + FURACAO',
    details: 'MDF BRANCO 15MM - 952.5X80MM',
  })),
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: vi.fn(),
  },
}));

import ReplacementLabelPreviewModal from '@/components/replacement/ReplacementLabelPreviewModal';

const order = {
  id: '96d44a0d-cd5d-44ce-89fd-7f4042e77417',
  replacement_code: 'REP-20260730-7006',
  status: 'requested',
  lot_code: '26072640',
  order_number: '940002',
  destination_cell_name: 'Corte',
  created_at: '2026-07-29T23:21:00.000Z',
  original_piece: {
    piece_code: '09950020',
    piece_name: 'PECA TESTE 20',
  },
};

describe('ReplacementLabelPreviewModal', () => {
  beforeEach(() => {
    getPrintHistoryMock.mockReset();
    recordPrintMock.mockReset();
    toastSuccessMock.mockReset();
    getPrintHistoryMock.mockResolvedValue([]);
    recordPrintMock.mockResolvedValue({ success: true, copy_number: 1 });
  });

  it('mantem a etiqueta montada ate a abertura da impressao e fecha somente depois', async () => {
    const sequence = [];
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {
      sequence.push('print');
    });
    const animationSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    recordPrintMock.mockImplementation(async () => {
      sequence.push('record');
      return { success: true, copy_number: 1 };
    });

    const onPrinted = vi.fn(() => sequence.push('printed'));
    const onOpenChange = vi.fn(() => sequence.push('close'));

    render(
      <ReplacementLabelPreviewModal
        open
        order={order}
        onPrinted={onPrinted}
        onOpenChange={onOpenChange}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /imprimir etiqueta/i }));

    await waitFor(() => expect(printSpy).toHaveBeenCalledOnce());
    expect(sequence).toEqual(['record', 'print', 'printed', 'close']);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(document.querySelector('#thermal-label-printable-area')).not.toBeNull();
    expect(document.querySelector('style')?.textContent).toContain('size: 100mm 50mm');

    printSpy.mockRestore();
    animationSpy.mockRestore();
  });
});
