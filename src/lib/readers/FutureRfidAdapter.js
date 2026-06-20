import ReaderAdapter from './BaseReaderAdapter';

export class FutureRfidAdapter extends ReaderAdapter {
  async connect() {
    this.connected = true;
    return { connected: true, simulated: true, message: 'Gateway RFID em modo de simulação.' };
  }

  async startReading() {
    return { started: this.connected, simulated: true };
  }

  async configureAntenna(config = {}) {
    this.config = { ...this.config, antenna: config };
    return this.config.antenna;
  }

  async simulateTag(rawValue, metadata = {}) {
    return this.processReading({
      ...metadata,
      rawValue,
      readerType: metadata.readerType || 'rfid_fixed',
      mode: 'rfid',
    });
  }
}

export default FutureRfidAdapter;
