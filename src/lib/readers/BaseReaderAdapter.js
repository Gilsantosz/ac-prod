export class BaseReaderAdapter {
  constructor(config = {}) {
    this.config = config;
    this.connected = false;
    this.callback = null;
    this.processor = config.processor || null;
    this.context = config.context || {};
  }

  async connect() {
    this.connected = true;
    return { connected: true };
  }

  async disconnect() {
    this.connected = false;
    return { connected: false };
  }

  async startReading() {
    return { started: this.connected };
  }

  async stopReading() {
    return { stopped: true };
  }

  onTagRead(callback) {
    this.callback = callback;
    return () => {
      if (this.callback === callback) this.callback = null;
    };
  }

  emitTag(reading) {
    this.callback?.(reading);
    return reading;
  }

  async processReading(reading) {
    const payload = { ...this.context, ...reading };
    const processor = this.processor || (await import('@/lib/traceabilityService')).processProductionReading;
    const result = await processor(payload);
    this.callback?.(payload, result);
    return result;
  }
}

export default BaseReaderAdapter;
