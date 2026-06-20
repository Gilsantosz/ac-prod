import BaseReaderAdapter from './BaseReaderAdapter';
import { FutureRfidAdapter } from './FutureRfidAdapter';
import { KeyboardBarcodeAdapter } from './KeyboardBarcodeAdapter';
import { ManualInputAdapter } from './ManualInputAdapter';

export { BaseReaderAdapter as ReaderAdapter } from './BaseReaderAdapter';
export { FutureRfidAdapter } from './FutureRfidAdapter';
export { KeyboardBarcodeAdapter } from './KeyboardBarcodeAdapter';
export { ManualInputAdapter } from './ManualInputAdapter';

export function createReaderAdapter(mode, config = {}) {
  if (mode === 'manual') return new ManualInputAdapter(config);
  if (mode === 'rfid') return new FutureRfidAdapter(config);
  return new KeyboardBarcodeAdapter(config);
}

export default BaseReaderAdapter;
