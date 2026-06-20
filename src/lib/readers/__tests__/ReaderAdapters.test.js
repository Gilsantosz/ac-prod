import { describe, expect, it, vi } from 'vitest';
import KeyboardBarcodeAdapter from '@/lib/readers/KeyboardBarcodeAdapter';
import ManualInputAdapter from '@/lib/readers/ManualInputAdapter';

describe('adapters de entrada', () => {
  it('processa Enter, limpa o campo e devolve o foco no scanner físico', async () => {
    const processor = vi.fn().mockResolvedValue({ success: true, status: 'approved' });
    const onClear = vi.fn();
    const focus = vi.fn();
    const adapter = new KeyboardBarcodeAdapter({
      processor,
      onClear,
      inputRef: { current: { focus } },
    });
    const event = { key: 'Enter', preventDefault: vi.fn() };

    const result = await adapter.handleKey(event, ' LSM-TEST-001-P001 ', { cellName: 'Corte' });

    expect(result.status).toBe('approved');
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(processor).toHaveBeenCalledWith(expect.objectContaining({
      rawValue: 'LSM-TEST-001-P001',
      readerType: 'keyboard_barcode',
      mode: 'scanner',
    }));
    expect(onClear).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it('ignora teclas que não sejam Enter', async () => {
    const processor = vi.fn();
    const adapter = new KeyboardBarcodeAdapter({ processor });
    expect(await adapter.handleKey({ key: 'A' }, 'TAG-001')).toBeNull();
    expect(processor).not.toHaveBeenCalled();
  });

  it('exige confirmação antes da baixa manual', async () => {
    const adapter = new ManualInputAdapter({ processor: vi.fn() });
    await expect(adapter.processInput('TAG-001', false)).rejects.toThrow('exige confirmação');
  });

  it('identifica a baixa manual confirmada', async () => {
    const processor = vi.fn().mockResolvedValue({ success: true, status: 'approved' });
    const adapter = new ManualInputAdapter({ processor });
    await adapter.processInput('TAG-001', true, { operator: 'Operador Teste' });
    expect(processor).toHaveBeenCalledWith(expect.objectContaining({
      readerType: 'manual',
      confirmed: true,
      operator: 'Operador Teste',
    }));
  });
});
