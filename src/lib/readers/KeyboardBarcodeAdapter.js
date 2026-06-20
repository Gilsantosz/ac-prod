import ReaderAdapter from './BaseReaderAdapter';

export class KeyboardBarcodeAdapter extends ReaderAdapter {
  async processInput(rawValue, metadata = {}) {
    const value = String(rawValue || '').trim();
    if (!value) return null;
    const result = await this.processReading({
      ...metadata,
      rawValue: value,
      readerType: 'keyboard_barcode',
      mode: 'scanner',
    });
    this.config.onClear?.();
    this.config.inputRef?.current?.focus?.();
    return result;
  }

  async handleKey(event, rawValue, metadata = {}) {
    if (event?.key !== 'Enter') return null;
    event.preventDefault?.();
    return this.processInput(rawValue, metadata);
  }
}

export default KeyboardBarcodeAdapter;
