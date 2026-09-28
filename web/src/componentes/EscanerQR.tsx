import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { codigoDesdeQr } from '../formato.ts';

export default function EscanerQR({ alLeer, alCerrar }: { alLeer: (codigo: string) => void; alCerrar: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const leido = useRef(false);
  const id = 'escaner-qr';

  useEffect(() => {
    const escaner = new Html5Qrcode(id, { verbose: false });
    const inicio = escaner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: (w, h) => ({ width: Math.min(w, h) * 0.7, height: Math.min(w, h) * 0.7 }) },
        (texto) => {
          if (leido.current) return;
          leido.current = true;
          alLeer(codigoDesdeQr(texto));
        },
        () => {},
      )
      .then(() => true)
      .catch(() => {
        setError('No se pudo acceder a la cámara. Revise los permisos o ingrese el código manualmente.');
        return false;
      });
    // Si se desmonta antes de que la cámara arranque, se detiene en cuanto arranca.
    return () => {
      void inicio.then((iniciado) => {
        if (iniciado) escaner.stop().catch(() => {});
      });
    };
  }, [alLeer]);

  return (
    <div className="tarjeta overflow-hidden">
      <div id={id} className="aspect-square w-full bg-stone-900 [&_video]:h-full [&_video]:object-cover" />
      <div className="flex items-center justify-between gap-3 p-3">
        <p className="text-sm text-stone-600">{error ?? 'Apunte la cámara al código QR del lote.'}</p>
        <button type="button" className="boton-secundario" onClick={alCerrar}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
