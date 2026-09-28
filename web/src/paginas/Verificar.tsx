import { Suspense, lazy, useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { codigoDesdeQr } from '../formato.ts';

// El lector QR es pesado: se descarga solo al abrir la cámara.
const EscanerQR = lazy(() => import('../componentes/EscanerQR.tsx'));

export function Verificar() {
  const navegar = useNavigate();
  const [codigo, setCodigo] = useState('');
  const [escaneando, setEscaneando] = useState(false);

  const ir = useCallback((c: string) => c && navegar(`/verificar/${encodeURIComponent(c)}`), [navegar]);

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Verificar un lote</h1>
      <p className="mt-2 text-stone-600">
        Escanee el código QR del lote o ingrese su código para comprobar que el análisis no fue alterado.
      </p>

      <form
        className="mt-8 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          ir(codigoDesdeQr(codigo));
        }}
      >
        <input
          className="campo font-mono uppercase"
          placeholder="LT-2026-0457"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          aria-label="Código del lote"
          autoFocus
        />
        <button className="boton-primario" disabled={!codigo.trim()}>
          Verificar
        </button>
      </form>

      <div className="mt-6">
        {escaneando ? (
          <Suspense fallback={<p className="tarjeta p-6 text-center text-stone-500">Abriendo cámara…</p>}>
            <EscanerQR alLeer={ir} alCerrar={() => setEscaneando(false)} />
          </Suspense>
        ) : (
          <button className="boton-secundario w-full py-3" onClick={() => setEscaneando(true)}>
            📷 Escanear código QR
          </button>
        )}
      </div>
    </div>
  );
}
