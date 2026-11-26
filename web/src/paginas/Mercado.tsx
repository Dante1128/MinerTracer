import { useState } from 'react';
import { Link } from 'react-router';
import type { AnuncioComercial } from '../api.ts';
import { TarjetaLote, TarjetaVendedor } from '../componentes/Mercado.tsx';
import { useConsultaComercial } from '../comercio.tsx';
import { agruparPorVendedor, useInfoMercado, useLotesMercado } from '../mercado.ts';

export function Mercado() {
  const info = useInfoMercado();
  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState('original');
  const [recarga, setRecarga] = useState(0);
  const { lotes, error } = useLotesMercado(info?.habilitado, recarga);
  const anuncios = useConsultaComercial<{ anuncios: AnuncioComercial[] }>('/anuncios?tipo=venta');
  const recargar = () => { setRecarga((valor) => valor + 1); anuncios.recargar(); };

  const normalizar = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
  const consulta = normalizar(busqueda.trim());
  const visibles = (lotes ?? []).filter((lote) =>
    normalizar([lote.lote_id, lote.tipo_mineral, lote.origen, lote.laboratorio?.nombre].filter(Boolean).join(' ')).includes(consulta),
  );
  if (orden !== 'original') {
    visibles.sort((a, b) => {
      const diferencia = (a.venta?.pureza_bps ?? a.pureza_bps) - (b.venta?.pureza_bps ?? b.pureza_bps);
      return orden === 'pureza-asc' ? diferencia : -diferencia;
    });
  }
  const vendedores = agruparPorVendedor(lotes ?? [], anuncios.datos?.anuncios ?? []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Lotes con análisis de laboratorio</h1>
      <p className="mt-2 max-w-3xl text-stone-600">
        Explore cuentas vendedoras y lotes con análisis anclado en Stellar. Al comprar, el pago queda en garantía
        hasta que confirma la recepción y acepta el material. Una incidencia bloquea el cobro mientras se resuelve;
        un reembolso de material recibido requiere acreditar su devolución.
      </p>
      <Link to="/comercio" className="boton-primario mt-5">Comparar ofertas en el mercado P2P →</Link>

      <section className="mt-10" aria-labelledby="directorio-vendedores">
        <h2 id="directorio-vendedores" className="text-xl font-bold tracking-tight">Explore vendedores</h2>
        <p className="mt-2 text-sm text-stone-600">Cada cuenta reúne sus publicaciones para negociar y sus ventas preparadas en el contrato. El análisis firmado no verifica por sí solo la identidad comercial del vendedor.</p>
        {anuncios.error && <div role="alert" className="mt-4 space-y-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><p>No se pudieron actualizar las publicaciones: {anuncios.error}</p><button className="boton-secundario" onClick={recargar}>Reintentar</button></div>}
        {vendedores.length > 0 ? <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{vendedores.map((vendedor) => <TarjetaVendedor key={vendedor.id} vendedor={vendedor} />)}</div>
          : anuncios.cargando || info === null || (info.habilitado && !error && lotes === null) ? <p role="status" className="mt-5 text-sm text-stone-500">Buscando cuentas con publicaciones o ventas…</p>
          : <p className="tarjeta mt-5 p-5 text-sm text-stone-600">Todavía no hay cuentas con publicaciones de venta o ventas preparadas visibles. <Link to="/comercio/nuevo?tipo=venta" className="font-semibold text-mineral-700 underline">Preparar mi venta</Link></p>}
      </section>

      <h2 className="mt-14 text-xl font-bold tracking-tight">Lotes con una venta preparada</h2>

      {info === null ? (
        <p className="mt-8 text-stone-500">Cargando…</p>
      ) : !info.habilitado ? (
        <p className="tarjeta mt-8 p-6 text-stone-600">
          Los lotes en venta necesitan una conexión al contrato de Stellar. Puede preparar una publicación
          desde el mercado P2P y guardarla como borrador.
        </p>
      ) : error ? (
        <div className="tarjeta mt-8 space-y-3 p-6">
          <p role="alert" className="text-red-700">{error}</p>
          <button className="boton-secundario" onClick={recargar}>Reintentar</button>
        </div>
      ) : lotes === null ? (
        <p className="mt-8 text-stone-500">Leyendo los lotes en venta del contrato…</p>
      ) : lotes.length === 0 ? (
        <div className="tarjeta mt-8 space-y-4 p-6 text-stone-600">
          <p>No hay lotes con una venta preparada en el contrato por ahora. Las publicaciones P2P pueden estar abiertas para negociar antes de reservar el lote.</p>
          <Link to="/comercio" className="boton-secundario">Ver publicaciones para negociar</Link>
          <p className="text-sm">Los dueños también pueden publicar un precio directamente desde <Link to="/mis-lotes" className="font-medium text-mineral-700 hover:underline">Mis lotes</Link>.</p>
        </div>
      ) : (
        <>
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
          {visibles.length === 0 && <div className="tarjeta mt-4 space-y-3 p-5">
            <p>No hay lotes que coincidan con su búsqueda.</p>
            <button className="boton-secundario" onClick={() => setBusqueda('')}>Limpiar búsqueda</button>
          </div>}
          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visibles.map((lote) => <TarjetaLote key={lote.lote_id} lote={lote} token={info.token} />)}
          </div>
        </>
      )}
    </div>
  );
}
