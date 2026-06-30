import { useEffect, useRef, useState } from 'react';
import { Camera, CameraIcon, Flashlight, Keyboard, Loader2, Pause, Play, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CameraScannerAdapter from '@/lib/readers/CameraScannerAdapter';
import CameraPermissionStatus from './CameraPermissionStatus';
import CameraScannerOverlay from './CameraScannerOverlay';

export default function MobileCameraScanner({ active, onDetected, onManual, feedback }) {
  const videoRef = useRef(null);
  const adapterRef = useRef(null);
  const processingRef = useRef(false);
  // Controla o fluxo de leitura ótica por webcam/câmera móvel
  const [permission, setPermission] = useState('idle');
  const [message, setMessage] = useState('');
  const [paused, setPaused] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [torch, setTorch] = useState(false);
  const [torchSupported, setTorchSupported] = useState(true);
  const [cameras, setCameras] = useState([]);
  const [cameraIndex, setCameraIndex] = useState(0);
  const [lastCode, setLastCode] = useState('');
  const [cycleMessage, setCycleMessage] = useState('Aponte a câmera para a etiqueta da peça');

  useEffect(() => {
    if (!active || !videoRef.current) return undefined;
    let mounted = true;
    const adapter = new CameraScannerAdapter({ videoElement: videoRef.current, debounceMs: 2000 });
    adapterRef.current = adapter;
    adapter.onTagRead(async (reading) => {
      if (!mounted || processingRef.current) return;
      processingRef.current = true;
      setProcessing(true);
      setLastCode(reading.rawValue);
      setCycleMessage('Código identificado. Processando coleta...');
      navigator.vibrate?.(80);
      await adapter.stopReading();
      setPaused(true);
      try {
        const result = await onDetected?.(reading);
        if (!mounted) return;
        setCycleMessage(result?.success
          ? 'Coleta registrada. Pronto para o próximo código.'
          : `${result?.message || 'Leitura não aprovada'} Pronto para a próxima leitura.`);
        await new Promise((resolve) => setTimeout(resolve, 700));
        if (!mounted) return;
        await adapter.startReading();
        if (!mounted) return;
        setPaused(false);
      } catch (error) {
        if (!mounted) return;
        setMessage(error?.message || 'Falha ao processar a leitura.');
        setCycleMessage('Falha na coleta. Toque em “Ler novamente”.');
      } finally {
        processingRef.current = false;
        if (mounted) setProcessing(false);
      }
    });

    const start = async () => {
      setPermission('requesting');
      try {
        await adapter.connect();
        if (!mounted) return;
        setPermission('granted');
        setCycleMessage('Aponte a câmera para a etiqueta da peça');
        setCameras(await adapter.getAvailableCameras());
        await adapter.startReading();
      } catch (error) {
        if (!mounted) return;
        const denied = error?.name === 'NotAllowedError' || /permiss/i.test(error?.message || '');
        setPermission(denied ? 'denied' : 'unsupported');
        setMessage(error?.message || 'Não foi possível iniciar a câmera.');
      }
    };
    start();

    return () => {
      mounted = false;
      adapter.disconnect();
      adapterRef.current = null;
    };
  }, [active, onDetected]);

  const togglePause = async () => {
    const adapter = adapterRef.current;
    if (!adapter || processingRef.current) return;
    if (paused) {
      await adapter.startReading();
      setPaused(false);
      setCycleMessage('Aponte a câmera para a etiqueta da peça');
    } else {
      await adapter.stopReading();
      setPaused(true);
    }
  };

  const toggleTorch = async () => {
    const result = await adapterRef.current?.setTorch(!torch);
    if (!result?.supported) {
      setTorchSupported(false);
      return;
    }
    setTorch(result.enabled);
  };

  const switchCamera = async () => {
    if (cameras.length < 2) return;
    const next = (cameraIndex + 1) % cameras.length;
    setCameraIndex(next);
    await adapterRef.current?.switchCamera(cameras[next].deviceId);
    setPaused(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-2"><Camera className="w-5 h-5" /> Coleta por Câmera</h3>
          <p className="text-sm text-muted-foreground">Aponte para a etiqueta do lote ou peça.</p>
        </div>
        <CameraPermissionStatus status={permission} message={message} />
      </div>

      <div className="relative w-full aspect-[4/3] sm:aspect-video bg-black rounded-md overflow-hidden">
        <video ref={videoRef} muted playsInline className="w-full h-full object-cover" />
        <CameraScannerOverlay feedback={feedback} message={cycleMessage} />
      </div>

      <div className="grid grid-cols-2 sm:flex gap-2">
        <Button type="button" variant="outline" onClick={togglePause} disabled={permission !== 'granted' || processing} className="gap-2">
          {processing ? <Loader2 className="animate-spin" /> : paused ? <Play /> : <Pause />}
          {processing ? 'Processando...' : paused ? 'Ler novamente' : 'Pausar'}
        </Button>
        <Button type="button" variant="outline" onClick={switchCamera} disabled={cameras.length < 2 || processing} className="gap-2">
          <RefreshCw /> Trocar câmera
        </Button>
        <Button type="button" variant="outline" onClick={toggleTorch} disabled={!torchSupported || permission !== 'granted' || processing} className="gap-2">
          <Flashlight /> {torch ? 'Desligar lanterna' : 'Lanterna'}
        </Button>
        <Button type="button" variant="outline" onClick={onManual} disabled={processing} className="gap-2">
          <Keyboard /> Digitar manualmente
        </Button>
      </div>

      {lastCode && (
        <div className="text-sm bg-secondary/60 border border-border rounded-md px-3 py-2 flex items-center gap-2">
          <CameraIcon className="w-4 h-4 text-muted-foreground" />
          <span className="text-muted-foreground">Último código:</span>
          <strong className="font-mono truncate">{lastCode}</strong>
        </div>
      )}
    </div>
  );
}
