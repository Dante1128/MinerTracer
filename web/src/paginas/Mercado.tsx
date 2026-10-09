import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, ErrorApi } from '../api.ts';
import { PillEstadoLote } from '../componentes/Mercado.tsx';
import { formatoPeso } from '../formato.ts';
import { formatoPrecio, formatoPureza, useInfoMercado, type EstadoComercial } from '../mercado.ts';

export function Mercado() {
  const info = useInfoMercado();
  const [lotes, setLotes] = useState<EstadoComercial[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!info?.habilitado) return;
    api<EstadoComercial[]>('/mercado/lotes')
      .then(setLotes)
      .catch((e) => setError(e instanceof ErrorApi ? e.message : 'No se pudo leer el contrato'));
  }, [info]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Mercado de lotes certificados</h1>
      <p className="mt-2 max-w-3xl text-stone-600">
        Lotes con análisis anclado en Stellar. Al comprar, el pago queda en garantía en el contrato hasta que usted confirma la
        recepción. Si un segundo laboratorio mide una pureza distinta, recupera su dinero.
      </p>

      {info === null ? (
        <p className="mt-8 text-stone-500">Cargando…</p>
      ) : !info.habilitado ? (
        <p className="tarjeta mt-8 p-6 text-stone-600">
          El mercado necesita el anclaje en Stellar. Este servidor usa el anclaje simulado (ANCLAJE=mock).
        </p>
      ) : error ? (
        <p className="tarjeta mt-8 p-6 text-red-700">{error}</p>
      ) : lotes === null ? (
        <p className="mt-8 text-stone-500">Leyendo los lotes en venta del contrato…</p>
      ) : lotes.length === 0 ? (
        <p className="tarjeta mt-8 p-6 text-stone-600">
          No hay lotes en venta por ahora. Los dueños publican sus lotes desde <Link to="/mis-lotes" className="font-medium text-mineral-700 hover:underline">Mis lotes</Link>.
        </p>
      ) : (
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {lotes.map((l) => (
            <Link key={l.lote_id} to={`/mercado/${l.lote_id}`} className="tarjeta block p-5 transition hover:shadow-md">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-semibold">{l.lote_id}</span>
                <PillEstadoLote estado={l.estado} />
              </div>
              <p className="mt-1 text-sm text-stone-600">
                {l.tipo_mineral ?? 'Lote'}
                {l.peso_kg && ` · ${formatoPeso(l.peso_kg)}`}
              </p>
              {l.origen && <p className="text-sm text-stone-500">{l.origen}</p>}
              <div className="mt-4 flex items-end justify-between">
                <div>
                  <p className="text-xs text-stone-500">Pureza certificada</p>
                  <p className="font-mono text-2xl font-bold">{formatoPureza(l.venta?.pureza_bps ?? l.pureza_bps)}%</p>
                </div>
                {l.venta && <p className="text-lg font-semibold">{formatoPrecio(l.venta.precio, info.token)}</p>}
              </div>
              <p className="mt-2 text-xs text-stone-500">{l.laboratorio?.nombre ?? 'Laboratorio autorizado en el contrato'}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
