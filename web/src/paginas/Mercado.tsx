import { useState } from 'react';
import { Link } from 'react-router';
import { TarjetaLote, TarjetaVendedor } from '../componentes/Mercado.tsx';
import { agruparPorVendedor, useInfoMercado, useLotesMercado, type EstadoComercial } from '../mercado.ts';

export function Mercado() {
  const info = useInfoMercado();
  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState('original');
  const [recarga, setRecarga] = useState(0);
  const { lotes, error } = useLotesMercado(info?.habilitado, recarga);

  const normalizar = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es');
  const consulta = normalizar(busqueda.trim());
  const visibles = (lotes ?? []).filter((lote) =>
    normalizar([lote.lote_id, lote.tipo_mineral, lote.origen, lote.laboratorio?.nombre].filter(Boolean).join(' ')).includes(consulta),
  );
  if (orden !== 'original') {
    visibles.sort((a: EstadoComercial, b: EstadoComercial) => {
      const diferencia = (a.venta?.pureza_bps ?? a.pureza_bps) - (b.venta?.pureza_bps ?? b.pureza_bps);
      return orden === 'pureza-asc' ? diferencia : -diferencia;
    });
  }
  const vendedores = agruparPorVendedor(lotes ?? []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Mercado de lotes certificados</h1>
      <p className="mt-2 max-w-3xl text-stone-600">
        Elija un vendedor certificado o explore todos los lotes. Cada uno muestra su procedencia y su análisis anclado en
        Stellar. Al comprar, <strong>el pago queda retenido en el contrato</strong> hasta que usted confirma la recepción;
        si un segundo laboratorio mide una pureza distinta, recupera su dinero.
      </p>

      {info === null ? (
        <p className="mt-8 text-stone-500">Cargando…</p>
      ) : !info.habilitado ? (
        <p className="tarjeta mt-8 p-6 text-stone-600">
          El mercado necesita el anclaje en Stellar. Este servidor usa el anclaje simulado (ANCLAJE=mock).
        </p>
      ) : error ? (
        <div className="tarjeta mt-8 space-y-3 p-6">
          <p role="alert" className="text-red-700">{error}</p>
          <button className="boton-secundario" onClick={() => setRecarga((n) => n + 1)}>Reintentar</button>
        </div>
      ) : lotes === null ? (
        <p className="mt-8 text-stone-500">Leyendo los lotes en venta del contrato…</p>
      ) : lotes.length === 0 ? (
        <p className="tarjeta mt-8 p-6 text-stone-600">
          No hay lotes en venta por ahora. Los dueños publican sus lotes desde <Link to="/mis-lotes" className="font-medium text-mineral-700 hover:underline">Mis lotes</Link>.
        </p>
      ) : (
        <>
          <h2 className="mt-10 text-xl font-bold tracking-tight">1. Elija un vendedor</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {vendedores.map((v) => (
              <TarjetaVendedor key={v.id} vendedor={v} />
            ))}
          </div>

          <h2 className="mt-14 text-xl font-bold tracking-tight">O explore todos los lotes</h2>
          <div className="tarjeta mt-4 grid gap-4 p-5 sm:grid-cols-2">
            <div>
              <label className="etiqueta" htmlFor="buscar-lotes">Buscar lotes</label>
              <input id="buscar-lotes" type="search" className="campo" placeholder="Código, mineral, origen o laboratorio" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </div>
            <div>
              <label className="etiqueta" htmlFor="orden-lotes">Ordenar por</label>
              <select id="orden-lotes" className="campo" value={orden} onChange={(e) => setOrden(e.target.value)}>
                <option value="original">Orden del mercado</option>
                <option value="pureza-desc">Mayor pureza</option>
                <option value="pureza-asc">Menor pureza</option>
              </select>
            </div>
            <p role="status" className="text-sm text-stone-600 sm:col-span-2">{visibles.length} de {lotes.length} lotes en venta</p>
          </div>
          {visibles.length === 0 && (
            <div className="tarjeta mt-4 space-y-3 p-5">
              <p>No hay lotes que coincidan con su búsqueda.</p>
              <button className="boton-secundario" onClick={() => setBusqueda('')}>Limpiar búsqueda</button>
            </div>
          )}
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visibles.map((l) => (
              <TarjetaLote key={l.lote_id} lote={l} token={info.token} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
