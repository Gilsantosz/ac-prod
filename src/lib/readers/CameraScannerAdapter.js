import ReaderAdapter from './BaseReaderAdapter';

const DEFAULT_FORMATS = [
  'qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'data_matrix', 'upc_a', 'upc_e',
];

export class CameraScannerAdapter extends ReaderAdapter {
  constructor(config = {}) {
    super(config);
    this.stream = null;
    this.videoElement = config.videoElement || null;
    this.detector = null;
    this.animationFrame = null;
    this.zxingControls = null;
    this.paused = false;
    this.lastValue = '';
    this.lastReadAt = 0;
    this.lastDetectedAt = 0;
    this.debounceMs = config.debounceMs || 2000;
    this.rearmAfterClearMs = config.rearmAfterClearMs || 700;
    this.deviceId = config.deviceId || null;
    this.fallback = false;
  }

  async connect() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Este navegador não oferece acesso à câmera.');
    }
    const constraints = {
      audio: false,
      video: this.deviceId
        ? { deviceId: { exact: this.deviceId } }
        : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.connected = true;
    if (this.videoElement) {
      this.videoElement.srcObject = this.stream;
      this.videoElement.setAttribute('playsinline', 'true');
      await this.videoElement.play();
    }
    return { connected: true, stream: this.stream };
  }

  async disconnect() {
    await this.stopReading();
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.videoElement) this.videoElement.srcObject = null;
    this.stream = null;
    this.connected = false;
  }

  async startReading() {
    if (!this.connected) await this.connect();
    this.paused = false;

    if ('BarcodeDetector' in window) {
      let formats = DEFAULT_FORMATS;
      if (window.BarcodeDetector.getSupportedFormats) {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        if (Array.isArray(supported) && supported.length > 0) {
          const compatibleFormats = DEFAULT_FORMATS.filter((format) => supported.includes(format));
          formats = compatibleFormats.length > 0 ? compatibleFormats : DEFAULT_FORMATS;
        }
      }
      this.detector = new window.BarcodeDetector({ formats });
      this.scanNative();
      return { started: true, engine: 'native' };
    }

    this.fallback = true;
    try {
      const module = await import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm');
      const reader = new module.BrowserMultiFormatReader();
      if (typeof reader.decodeFromStream === 'function') {
        this.zxingControls = await reader.decodeFromStream(this.stream, this.videoElement, (result) => {
          if (result?.getText) this.emitValue(result.getText(), result.getBarcodeFormat?.());
          else this.markNoDetection();
        });
      } else {
        this.zxingControls = await reader.decodeFromVideoDevice(this.deviceId, this.videoElement, (result) => {
          if (result?.getText) this.emitValue(result.getText(), result.getBarcodeFormat?.());
          else this.markNoDetection();
        });
      }
      return { started: true, engine: 'zxing' };
    } catch {
      throw new Error('Leitura visual indisponível neste navegador. Use scanner físico ou digitação manual.');
    }
  }

  async stopReading() {
    this.paused = true;
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    this.zxingControls?.stop?.();
    this.zxingControls = null;
    return { stopped: true };
  }

  scanNative = async () => {
    if (this.paused || !this.detector || !this.videoElement) return;
    try {
      const detections = await this.detector.detect(this.videoElement);
      const result = detections[0];
      if (result?.rawValue) this.emitValue(result.rawValue, result.format);
      else this.markNoDetection();
    } catch {
      // Quadros sem leitura são esperados; a captura continua.
    }
    this.animationFrame = requestAnimationFrame(this.scanNative);
  };

  emitValue(rawValue, format = '') {
    const value = String(rawValue || '').trim();
    if (value.length < 3) return;
    const now = Date.now();
    this.lastDetectedAt = now;
    if (value === this.lastValue) return;
    this.lastValue = value;
    this.lastReadAt = now;
    const normalizedFormat = String(format || '').toLowerCase();
    const reading = {
      rawValue: value,
      readerType: normalizedFormat.includes('qr') ? 'camera_qrcode' : 'camera_barcode',
      readerName: 'Câmera Mobile',
      mode: 'camera',
      detectedTagType: normalizedFormat.includes('qr') ? 'qrcode' : normalizedFormat.includes('data_matrix') ? 'datamatrix' : 'barcode',
      detectedTagFormat: normalizedFormat.includes('qr') ? 'qrcode' : normalizedFormat.includes('data_matrix') ? 'datamatrix' : normalizedFormat.includes('128') ? 'code128' : 'custom',
    };
    if (this.config.autoProcess) this.processReading(reading);
    else this.emitTag(reading);
  }

  markNoDetection() {
    if (!this.lastValue || Date.now() - this.lastDetectedAt < this.rearmAfterClearMs) return;
    this.lastValue = '';
    this.lastReadAt = 0;
  }

  async setTorch(enabled) {
    const track = this.stream?.getVideoTracks?.()[0];
    const capabilities = track?.getCapabilities?.() || {};
    if (!track || !capabilities.torch) return { supported: false, enabled: false };
    await track.applyConstraints({ advanced: [{ torch: !!enabled }] });
    return { supported: true, enabled: !!enabled };
  }

  async switchCamera(deviceId) {
    await this.disconnect();
    this.deviceId = deviceId;
    await this.connect();
    return this.startReading();
  }

  async getAvailableCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'videoinput');
  }
}

export default CameraScannerAdapter;
