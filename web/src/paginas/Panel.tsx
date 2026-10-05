import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, ErrorApi, type Analisis, type Lote } from '../api.ts';
import { esperaFirma } from '../componentes/FirmaLaboratorio.tsx';
import { EstadoAnclaje } from '../componentes/Insignias.tsx';
import { formatoFechaHora, formatoPeso } from '../formato.ts';
import { anclajeReal, useInfoServidor } from '../infoServidor.ts';
import { useSesion } from '../sesion.tsx';

export function Panel() {
  const { usuario } = useSesion();
  const info = useInfoServidor();
  const firmaWallet = info?.firma_laboratorio === 'wallet';
  const [analisis, setAnalisis] = useState<Analisis[] | null>(null);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [pestana, setPestana] = useState<'analisis' | 'lotes'>('analisis');
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vigente = true;
    let temporizador: ReturnType<typeof setTimeout>;
    const cargar = async () => {
      try {
        const [a, l] = await Promise.all([api<Analisis[]>('/analisis'), api<Lote[]>('/lotes')]);
        if (!vigente) return;
        setAnalisis(a);
        setLotes(l);
        setError(null);
        if (a.some((x) => x.estado_anclaje === 'pendiente' && !esperaFirma(x, firmaWallet))) temporizador = setTimeout(cargar, 3000);
      } catch (e) {
        if (vigente) setError(e instanceof ErrorApi ? e.message : 'Error inesperado al cargar el panel');
      }
    };
    void cargar();
    return () => {
      vigente = false;
      clearTimeout(temporizador);
    };
  }, [recarga, firmaWallet]);

  const pendientes = analisis?.filter((a) => a.estado_anclaje === 'pendiente').length ?? 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-stone-500">
            {usuario?.laboratorio_id} · {usuario?.nombre} ({usuario?.rol})
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Análisis registrados</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {anclajeReal(info) && (
            <Link to="/laboratorio/contra-analisis" className="boton-secundario">
              Contra-análisis
            </Link>
          )}
          <Link to="/laboratorio/nuevo" className="boton-primario">
            + Registrar análisis
          </Link>
        </div>
      </div>

      {error && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
          <p className="font-medium">No se pudo cargar el panel: {error}</p>
          <button className="boton-secundario" onClick={() => setRecarga((n) => n + 1)}>
            Reintentar
          </button>
        </div>
      )}

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat etiqueta="Análisis" valor={analisis?.length ?? '—'} />
        <Stat etiqueta="Lotes" valor={lotes.length} />
        <Stat etiqueta="Pendientes de anclaje" valor={analisis ? pendientes : '—'} />
      </div>

      <div className="mt-8 flex gap-1 border-b border-stone-200" role="tablist">
        {(['analisis', 'lotes'] as const).map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={pestana === p}
            onClick={() => setPestana(p)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${pestana === p ? 'border-stone-900 text-stone-900' : 'border-transparent text-stone-500 hover:text-stone-800'}`}
          >
            {p === 'analisis' ? 'Análisis' : 'Lotes'}
          </button>
        ))}
      </div>

      {pestana === 'analisis' ? (
        <div className="tarjeta mt-4 overflow-x-auto">
          {analisis === null ? (
            <p className="p-6 text-stone-500">{error ? 'Sin datos.' : 'Cargando…'}</p>
          ) : analisis.length === 0 ? (
            <p className="p-6 text-stone-500">Aún no hay análisis. Registre el primero.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-stone-200 text-xs text-stone-500 uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Análisis</th>
                  <th className="px-4 py-3 font-medium">Lote</th>
                  <th className="px-4 py-3 font-medium">Pureza</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Fecha</th>
                  <th className="px-4 py-3 font-medium">Anclaje</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {analisis.map((a) => (
                  <tr key={a.analisis_id} className="hover:bg-stone-50">
                    <td className="px-4 py-3">
                      <Link to={`/laboratorio/analisis/${a.analisis_id}`} className="font-mono font-semibold hover:underline">
                        {a.analisis_id}
                      </Link>
                      {a.version > 1 && <span className="ml-2 text-xs text-stone-500">v{a.version}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono">{a.lote_id}</span>
                      <span className="block text-xs text-stone-500">{a.tipo_mineral}</span>
                    </td>
                    <td className="px-4 py-3 font-mono">{a.pureza}%</td>
                    <td className="hidden px-4 py-3 text-stone-600 md:table-cell">{formatoFechaHora(a.fecha_analisis)}</td>
                    <td className="px-4 py-3">
                      <EstadoAnclaje analisis={a} esperaFirma={esperaFirma(a, firmaWallet)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {lotes.length === 0 && <p className="text-stone-500">Aún no hay lotes.</p>}
          {lotes.map((l) => (
            <div key={l.id} className="tarjeta p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold">{l.id}</span>
                <Link to={`/verificar/${l.id}`} className="text-sm text-mineral-700 hover:underline">
                  Vista pública ↗
                </Link>
              </div>
              <p className="text-sm text-stone-600">
                {l.tipo_mineral} · {formatoPeso(l.peso_kg)}
              </p>
              <p className="text-sm text-stone-500">{l.origen}</p>
              <p className="mt-1 text-xs text-stone-500">{l.total_analisis} análisis</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ etiqueta, valor }: { etiqueta: string; valor: number | string }) {
  return (
    <div className="tarjeta p-4">
      <p className="text-xs text-stone-500">{etiqueta}</p>
      <p className="text-2xl font-bold tabular-nums">{valor}</p>
    </div>
  );
}
