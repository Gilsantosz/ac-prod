import ReaderAdapter from './BaseReaderAdapter';

export class ManualInputAdapter extends ReaderAdapter {
  async processInput(rawValue, confirmed = false, metadata = {}) {
    if (!confirmed) throw new Error('A digitação manual exige confirmação do operador.');
    const value = String(rawValue || '').trim();
    if (!value) return null;
    return this.processReading({
      ...metadata,
      rawValue: value,
      readerType: 'manual',
      mode: 'manual',
      confirmed: true,
    });
  }
}

export default ManualInputAdapter;
