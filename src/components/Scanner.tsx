import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, CameraOff, Keyboard, ScanLine } from 'lucide-react';
import { Button, Field, Input, Modal } from './ui';

interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
}

export function Scanner({
  open,
  onClose,
  onResult,
  title = 'Escanear código',
}: {
  open: boolean;
  onClose: () => void;
  onResult: (code: string) => void;
  title?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const [scanning, setScanning] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: number | undefined;

    const start = async () => {
      try {
        setError(null);
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setScanning(true);

        const AnyWindow = window as unknown as { BarcodeDetector?: new () => BarcodeDetectorLike };
        const detector = AnyWindow.BarcodeDetector ? new AnyWindow.BarcodeDetector() : null;

        const tick = async () => {
          if (stopped || !videoRef.current) return;
          const v = videoRef.current;
          if (v.readyState === v.HAVE_ENOUGH_DATA) {
            let code: string | null = null;
            if (detector) {
              try {
                const results = await detector.detect(v);
                if (results.length > 0) code = results[0].rawValue;
              } catch {
                /* continuar con jsQR */
              }
            }
            if (!code && canvasRef.current) {
              const canvas = canvasRef.current;
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                canvas.width = v.videoWidth;
                canvas.height = v.videoHeight;
                ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const result = jsQR(image.data, image.width, image.height, {
                  inversionAttempts: 'dontInvert',
                });
                if (result?.data) code = result.data;
              }
            }
            if (code) {
              setLastCode(code);
              if (navigator.vibrate) navigator.vibrate(60);
              onResultRef.current(code.trim());
              stopped = true;
              return;
            }
          }
          timer = window.setTimeout(tick, 220);
        };
        tick();
      } catch {
        setError(
          'No se pudo acceder a la cámara. Verifique los permisos del navegador o ingrese el código manualmente.',
        );
      }
    };

    start();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      setScanning(false);
    };
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      subtitle="Apunte la cámara al código de barras o QR del producto"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        </>
      }
    >
      <div className="scanner-frame">
        <video ref={videoRef} className="scanner-video" muted playsInline />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        {!scanning && !error && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              color: '#cbd5e1',
              gap: 8,
            }}
          >
            <Camera size={30} />
          </div>
        )}
        {error && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              background: 'rgba(3,10,16,.86)',
              color: '#e2e8f0',
              padding: 22,
              textAlign: 'center',
              fontSize: 12.5,
              lineHeight: 1.5,
            }}
          >
            <div>
              <CameraOff size={28} style={{ marginBottom: 8 }} />
              <div>{error}</div>
            </div>
          </div>
        )}
      </div>

      {lastCode && (
        <div className="row small" style={{ color: 'var(--ok)' }}>
          <ScanLine size={15} /> Último código leído: <strong className="mono">{lastCode}</strong>
        </div>
      )}

      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <Field label="Ingreso manual" className="grow">
          <Input
            placeholder="Ej. 7701100000137 o SKU"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && manual.trim()) {
                onResultRef.current(manual.trim());
                setManual('');
              }
            }}
          />
        </Field>
        <Button
          variant="primary"
          icon={<Keyboard size={15} />}
          onClick={() => {
            if (manual.trim()) {
              onResultRef.current(manual.trim());
              setManual('');
            }
          }}
        >
          Usar
        </Button>
      </div>
    </Modal>
  );
}
