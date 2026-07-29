import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ScannerModeSelector from './ScannerModeSelector';

describe('ScannerModeSelector', () => {
  it('mantém a baixa individual e oferece a baixa por volume separadamente', () => {
    const onChange = vi.fn();

    render(
      <ScannerModeSelector
        value="scanner"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /código individual/i }));
    fireEvent.click(screen.getByRole('radio', { name: /baixa por volume/i }));

    expect(onChange).toHaveBeenNthCalledWith(1, 'manual');
    expect(onChange).toHaveBeenNthCalledWith(2, 'volume');
  });
});
