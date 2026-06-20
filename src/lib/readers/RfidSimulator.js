import FutureRfidAdapter from './FutureRfidAdapter';

export class RfidSimulator {
  constructor(config = {}) {
    this.debounceMs = Number(config.debounceMs) || 2000;
    this.now = config.now || (() => Date.now());
    this.lastReads = new Map();
    this.adapter = config.adapter || new FutureRfidAdapter(config);
    this.defaultMetadata = {
      readerType: config.readerType || 'rfid_fixed',
      readerId: config.readerId || 'RFID-SIMULATOR-01',
      stationName: config.stationName || 'Estação RFID Simulada',
      cellName: config.cellName || 'Corte',
    };
  }

  generateEpc(sequence = 1) {
    return `EPC-TEST-${String(sequence).padStart(12, '0')}`;
  }

  async read(epc, metadata = {}) {
    const rawValue = String(epc || '').trim().toUpperCase();
    const timestamp = this.now();
    const lastRead = this.lastReads.get(rawValue);
    if (lastRead != null && timestamp - lastRead < this.debounceMs) {
      return {
        success: false,
        status: 'duplicated',
        message: 'EPC ignorado pelo intervalo de segurança da leitura RFID.',
        lot: null,
        item: null,
        route: null,
        reading: { tag_value: rawValue, ...this.defaultMetadata, ...metadata },
        nextStep: null,
        occurrence: null,
        kpiUpdate: null,
      };
    }
    this.lastReads.set(rawValue, timestamp);
    return this.adapter.simulateTag(rawValue, { ...this.defaultMetadata, ...metadata });
  }

  readRepeated(epc, metadata = {}) {
    return Promise.all([this.read(epc, metadata), this.read(epc, metadata)]);
  }

  async readMany(epcs, metadata = {}) {
    const uniqueEpcs = [...new Set((epcs || []).map((epc) => String(epc).trim().toUpperCase()).filter(Boolean))];
    return Promise.all(uniqueEpcs.map((epc) => this.read(epc, metadata)));
  }

  readInWrongCell(epc, cellName = 'Célula Incorreta') {
    return this.read(epc, { cellName });
  }
}

export default RfidSimulator;
