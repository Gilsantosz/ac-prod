import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MobileCameraScanner from '@/components/traceability/MobileCameraScanner';
import { renderWithProviders } from '@/test/utils/renderWithProviders';

let detection = null;
let repeatDetection = false;
let track;
let stream;

class BarcodeDetectorMock {
  static getSupportedFormats = vi.fn().mockResolvedValue([
    'qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'data_matrix', 'upc_a', 'upc_e',
  ]);

  async detect() {
    const current = detection;
    if (!repeatDetection) detection = null;
    return current ? [current] : [];
  }
}

function configureCamera() {
  track = {
    stop: vi.fn(),
    getCapabilities: vi.fn().mockReturnValue({ torch: true }),
    applyConstraints: vi.fn().mockResolvedValue(undefined),
  };
  stream = {
    getTracks: vi.fn().mockReturnValue([track]),
    getVideoTracks: vi.fn().mockReturnValue([track]),
  };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue(stream),
      enumerateDevices: vi.fn().mockResolvedValue([
        { kind: 'videoinput', deviceId: 'rear-camera', label: 'Câmera traseira' },
      ]),
    },
  });
  global.BarcodeDetector = BarcodeDetectorMock;
  window.BarcodeDetector = BarcodeDetectorMock;
}

function renderScanner(props = {}) {
  const onDetected = props.onDetected || vi.fn().mockResolvedValue({ success: true, status: 'approved' });
  const onManual = props.onManual || vi.fn();
  const result = renderWithProviders(
    <MobileCameraScanner active onDetected={onDetected} onManual={onManual} feedback={null} />,
  );
  return { ...result, onDetected, onManual };
}

describe('MobileCameraScanner', () => {
  beforeEach(() => {
    detection = null;
    repeatDetection = false;
    configureCamera();
  });

  afterEach(() => {
    delete global.BarcodeDetector;
    delete window.BarcodeDetector;
  });

  it('solicita permissão de câmera', async () => {
    renderScanner();
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce());
    expect(await screen.findByText('Câmera pronta para leitura')).toBeInTheDocument();
  });

  it('solicita preferencialmente a câmera traseira', async () => {
    renderScanner();
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce());
    expect(navigator.mediaDevices.getUserMedia.mock.calls[0][0]).toMatchObject({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    });
  });

  it.each([
    ['QR:LSM-TEST-001-P001', 'qr_code', 'camera_qrcode'],
    ['LSM-TEST-001-P001', 'code_128', 'camera_barcode'],
  ])('lê %s simulado', async (rawValue, format, readerType) => {
    detection = { rawValue, format };
    const { onDetected } = renderScanner();
    await waitFor(() => expect(onDetected).toHaveBeenCalledOnce());
    expect(onDetected.mock.calls[0][0]).toMatchObject({ rawValue, readerType });
  });

  it('aplica debounce para não processar continuamente o mesmo código', async () => {
    detection = { rawValue: 'LSM-TEST-001-P001', format: 'code_128' };
    repeatDetection = true;
    const { onDetected } = renderScanner();
    await waitFor(() => expect(onDetected).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(onDetected).toHaveBeenCalledOnce();
  });

  it('desliga o stream ao desmontar a tela', async () => {
    const { unmount } = renderScanner();
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce());
    unmount();
    await waitFor(() => expect(track.stop).toHaveBeenCalledOnce());
  });

  it('oferece digitação manual quando a permissão é negada', async () => {
    const denied = Object.assign(new Error('Permissão negada'), { name: 'NotAllowedError' });
    navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(denied);
    const user = userEvent.setup();
    const { onManual } = renderScanner();
    expect(await screen.findByText('Permissão negada')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /digitar manualmente/i }));
    expect(onManual).toHaveBeenCalledOnce();
  });

  it('mantém fallback manual quando BarcodeDetector não existe', async () => {
    delete global.BarcodeDetector;
    delete window.BarcodeDetector;
    const user = userEvent.setup();
    const { onManual } = renderScanner();
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce());
    await user.click(screen.getByRole('button', { name: /digitar manualmente/i }));
    expect(onManual).toHaveBeenCalledOnce();
  });

  it('mantém a leitura integrada ao processador central recebido', async () => {
    detection = { rawValue: 'LSM-TEST-001-P001', format: 'code_128' };
    const processProductionReading = vi.fn().mockResolvedValue({ success: true, status: 'approved' });
    renderScanner({ onDetected: processProductionReading });
    await waitFor(() => expect(processProductionReading).toHaveBeenCalledOnce());
  });

  it('não grava leitura visual inválida', async () => {
    detection = { rawValue: 'X', format: 'code_128' };
    const { onDetected } = renderScanner();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(onDetected).not.toHaveBeenCalled();
  });
});
