import { afterEach, describe, expect, it, vi } from 'vitest';
import { printVolumeLabel } from './volumeLabelPrinter';

describe('printVolumeLabel', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('insere dados operacionais como texto, sem criar HTML executável', () => {
    vi.useFakeTimers();
    const popupDocument = document.implementation.createHTMLDocument('');
    const popup = {
      document: popupDocument,
      opener: window,
      focus: vi.fn(),
      print: vi.fn(),
      close: vi.fn(),
    };
    vi.spyOn(window, 'open').mockReturnValue(popup);

    const maliciousValue = '</div><img src=x onerror="alert(1)">';
    const opened = printVolumeLabel({
      volumeCode: maliciousValue,
      lotCode: maliciousValue,
      customerName: maliciousValue,
      generatedAt: '11/08/2026',
    });

    vi.runAllTimers();

    expect(opened).toBe(true);
    expect(popup.opener).toBeNull();
    expect(popupDocument.body.querySelector('img')).toBeNull();
    expect(popupDocument.body.textContent).toContain(maliciousValue);
    expect(popup.print).toHaveBeenCalledOnce();
  });
});
