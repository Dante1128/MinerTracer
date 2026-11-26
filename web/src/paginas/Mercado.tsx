import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { AnuncioComercial } from '../api.ts';
import { TarjetaVendedor } from '../componentes/Mercado.tsx';
import { useConsultaComercial } from '../comercio.tsx';
import { acortar } from '../formato.ts';
import { agruparPorVendedor, formatoPrecio, formatoPureza, useInfoMercado, useLotesMercado, type EstadoComercial, type InfoToken } from '../mercado.ts';

type Orden = 'precio-asc' | 'precio-desc' | 'pureza-desc' | 'gramo-asc';

const normalizar = (texto: string) => texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es');

/** "Concentrado de estaño" → "Estaño"; "Doré de oro" → "Oro". */
function mineralCorto(tipo: string | null | undefined): string {
  if (!tipo) return 'Otro';
  const ultimo = tipo.split(' de ').pop()!.trim();
  return ultimo.charAt(0).toLocaleUpperCase('es') + ultimo.slice(1);
}

const totalDe = (lote: EstadoComercial) => BigInt(lote.venta_comercial?.total ?? lote.venta?.precio ?? '0');

/** Precio por gramo solo para comparar; el importe exacto es el total del contrato. */
function precioPorGramo(lote: EstadoComercial, token: InfoToken): number | null {
  const gramos = Number(lote.peso_kg) * 1000;
  if (!lote.venta || !gramos) return null;
  return Number(BigInt(lote.venta.precio)) / 10 ** token.decimales / gramos;
}

/** Este mercado solo ofrece oro. */
const esOro = (lote: EstadoComercial) => mineralCorto(lote.tipo_mineral) === 'Oro';

/** "12.5" → "12,5 kg"; por debajo de 1 kg, en gramos. */
function formatoCantidad(kg: string | null | undefined): string {
  const valor = Number(kg);
  if (!kg || !valor) return '—';
  return valor < 1
    ? `${(valor * 1000).toLocaleString('es', { maximumFractionDigits: 1 })} g`
    : `${valor.toLocaleString('es', { maximumFractionDigits: 3 })} kg`;
}

const formatoUnitario = (valor: number) =>
  valor.toLocaleString('es', valor >= 1 ? { maximumFractionDigits: 2 } : { maximumSignificantDigits: 3 });


function Avatar({ nombre }: { nombre: string }) {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-mineral-500 text-sm font-bold text-stone-950" aria-hidden>
      {nombre.replace(/^[^A-Za-zÀ-ÿ]+/, '').charAt(0).toUpperCase() || '?'}
    </span>
  );
}

export function Mercado() {
  const info = useInfoMercado();
  const navegar = useNavigate();
  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState<Orden>('precio-asc');
  const [recarga, setRecarga] = useState(0);
  const { lotes, error } = useLotesMercado(info?.habilitado, recarga);
  const anuncios = useConsultaComercial<{ anuncios: AnuncioComercial[] }>('/anuncios?tipo=venta');
  const recargar = () => { setRecarga((valor) => valor + 1); anuncios.recargar(); };

  const vendedores = agruparPorVendedor(lotes ?? [], anuncios.datos?.anuncios ?? []);
  const nombreVendedor = new Map(vendedores.map((v) => [v.id, v.nombre]));
  const vendedoresOro = vendedores.filter((v) => v.minerales.some((m) => mineralCorto(m) === 'Oro'));
  const enVenta = (lotes ?? []).filter((l) => l.venta && esOro(l));
  const token = info?.habilitado ? info.token : null;

  const consulta = normalizar(busqueda.trim());
  const visibles = enVenta
    .filter((l) => normalizar([l.lote_id, l.tipo_mineral, l.origen, l.laboratorio?.nombre, nombreVendedor.get(l.venta!.vendedor)].filter(Boolean).join(' ')).includes(consulta))
    .sort((a, b) => {
      if (orden === 'pureza-desc') return (b.venta!.pureza_bps) - (a.venta!.pureza_bps);
      if (orden === 'gramo-asc' && token) return (precioPorGramo(a, token) ?? Infinity) - (precioPorGramo(b, token) ?? Infinity);
      const d = totalDe(a) - totalDe(b);
      return (orden === 'precio-desc' ? -1 : 1) * (d > 0n ? 1 : d < 0n ? -1 : 0);
    });

  const volumen = enVenta.reduce((s, l) => s + totalDe(l), 0n);
  const mejorPureza = enVenta.reduce((m, l) => Math.max(m, l.venta!.pureza_bps), 0);
  const kgTotales = enVenta.reduce((s, l) => s + (Number(l.peso_kg) || 0), 0);

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* Cabecera tipo exchange */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-mineral-400">Mercado de oro · Stellar Testnet</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Compra oro certificado</h1>
            <p className="mt-1 text-sm text-stone-400">
              Pagas en {token?.simbolo ?? 'el token del contrato'}; el dinero queda en garantía en el contrato hasta que confirmas la recepción.
            </p>
          </div>
          <div className="flex rounded-lg bg-stone-900 p-1 text-sm font-semibold ring-1 ring-stone-800">
            <span className="rounded-md bg-emerald-500 px-5 py-2 text-stone-950">Comprar</span>
            <Link to="/mis-lotes" className="rounded-md px-5 py-2 text-stone-400 hover:text-white">Vender</Link>
            <Link to="/comercio" className="rounded-md px-5 py-2 text-stone-400 hover:text-white">Negociar</Link>
          </div>
        </div>

        {/* Indicadores */}
        {token && lotes && (
          <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-stone-800 ring-1 ring-stone-800 md:grid-cols-4">
            {[
              ['Lotes en venta', String(enVenta.length)],
              ['Oro ofertado', formatoCantidad(String(kgTotales))],
              ['Volumen ofertado', formatoPrecio(volumen.toString(), token)],
              ['Mejor ley', mejorPureza ? `${formatoPureza(mejorPureza)} % Au` : '—'],
            ].map(([titulo, valor]) => (
              <div key={titulo} className="bg-stone-900 px-5 py-4">
                <dt className="text-xs text-stone-400">{titulo}</dt>
                <dd className="mt-1 font-mono text-lg font-semibold text-white">{valor}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* Libro de ofertas */}
        <section className="mt-6 rounded-xl bg-stone-900 ring-1 ring-stone-800" aria-labelledby="titulo-ofertas">
          <h2 id="titulo-ofertas" className="sr-only">Ofertas de oro</h2>
          <div className="flex flex-wrap items-center gap-3 border-b border-stone-800 p-4">
            <p className="flex items-center gap-2 font-semibold">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-yellow-400 text-xs font-black text-stone-950" aria-hidden>Au</span>
              Oro <span className="text-sm font-normal text-stone-500">/ {token?.simbolo ?? 'USDC'}</span>
            </p>
            <div className="ml-auto flex flex-wrap gap-2">
              <input
                type="search"
                aria-label="Buscar ofertas"
                placeholder="Buscar lote, origen, vendedor…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="w-56 rounded-md bg-stone-800 px-3 py-1.5 text-sm text-white placeholder:text-stone-500 ring-1 ring-stone-700 focus:ring-mineral-500 focus:outline-none"
              />
              <select
                aria-label="Ordenar"
                value={orden}
                onChange={(e) => setOrden(e.target.value as Orden)}
                className="rounded-md bg-stone-800 px-3 py-1.5 text-sm text-white ring-1 ring-stone-700 focus:ring-mineral-500 focus:outline-none"
              >
                <option value="precio-asc">Precio: menor primero</option>
                <option value="precio-desc">Precio: mayor primero</option>
                <option value="gramo-asc">Precio por gramo: menor</option>
                <option value="pureza-desc">Mayor ley</option>
              </select>
              <button onClick={recargar} className="rounded-md px-3 py-1.5 text-sm text-stone-400 ring-1 ring-stone-700 hover:text-white" title="Actualizar">↻</button>
            </div>
          </div>

          {info === null || (info.habilitado && !error && lotes === null) ? (
            <p role="status" className="p-10 text-center text-sm text-stone-400">Leyendo las ofertas del contrato…</p>
          ) : !info.habilitado ? (
            <p className="p-10 text-center text-sm text-stone-400">Las ofertas necesitan conexión al contrato de Stellar. Puede preparar una publicación desde <Link to="/comercio" className="text-mineral-400 underline">Negociar</Link>.</p>
          ) : error ? (
            <div role="alert" className="space-y-3 p-10 text-center text-sm">
              <p className="text-red-400">{error}</p>
              <button className="rounded-md bg-stone-800 px-4 py-2 font-semibold hover:bg-stone-700" onClick={recargar}>Reintentar</button>
            </div>
          ) : visibles.length === 0 ? (
            <div className="space-y-3 p-10 text-center text-sm text-stone-400">
              <p>{enVenta.length === 0 ? 'No hay oro en venta por ahora.' : 'Ninguna oferta coincide con la búsqueda.'}</p>
              {enVenta.length > 0 && <button className="text-mineral-400 underline" onClick={() => setBusqueda('')}>Limpiar búsqueda</button>}
            </div>
          ) : (
            <>
              {/* Escritorio: tabla */}
              <table className="hidden w-full text-sm md:table">
                <thead className="text-left text-xs text-stone-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Vendedor</th>
                    <th className="px-4 py-3 font-medium">Lote</th>
                    <th className="px-4 py-3 text-right font-medium">Ley (Au)</th>
                    <th className="px-4 py-3 text-right font-medium">Cantidad</th>
                    <th className="px-4 py-3 text-right font-medium">Precio/g</th>
                    <th className="px-4 py-3 text-right font-medium">Total a pagar</th>
                    <th className="px-4 py-3"><span className="sr-only">Acción</span></th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((lote) => {
                    const vendedor = lote.venta!.vendedor;
                    const nombre = nombreVendedor.get(vendedor) ?? acortar(vendedor, 5);
                    const gramo = precioPorGramo(lote, info.token);
                    const reservado = !!lote.venta_comercial?.comprador_reservado;
                    return (
                      <tr key={lote.lote_id} className="cursor-pointer border-t border-stone-800 transition hover:bg-stone-800/60" onClick={() => navegar(`/mercado/${lote.lote_id}`)}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Avatar nombre={nombre} />
                            <div className="min-w-0">
                              <Link to={`/mercado/vendedor/${vendedor}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-white hover:text-mineral-400">{nombre}</Link>
                              <p className="truncate text-xs text-stone-500">✓ {lote.laboratorio?.nombre ?? 'Laboratorio autorizado'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-yellow-300">{lote.tipo_mineral ?? 'Oro'}</p>
                          <p className="font-mono text-xs text-stone-400">{lote.lote_id}</p>
                          {lote.origen && <p className="max-w-56 truncate text-xs text-stone-500" title={lote.origen}>{lote.origen}</p>}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-400">{formatoPureza(lote.venta!.pureza_bps)} %</td>
                        <td className="px-4 py-3 text-right font-mono text-stone-300">{formatoCantidad(lote.peso_kg)}</td>
                        <td className="px-4 py-3 text-right font-mono text-stone-300">{gramo !== null ? `${formatoUnitario(gramo)} ${info.token.simbolo}` : '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <p className="font-mono text-base font-bold text-white">{formatoPrecio(totalDe(lote).toString(), info.token)}</p>
                          {lote.venta_comercial && <p className="text-xs text-stone-500">incl. comisión {formatoPrecio(lote.venta_comercial.comision, info.token)}</p>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            to={`/mercado/${lote.lote_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className={`inline-block rounded-md px-5 py-2 text-sm font-bold ${reservado ? 'bg-stone-700 text-stone-300' : 'bg-emerald-500 text-stone-950 hover:bg-emerald-400'}`}
                          >
                            {reservado ? 'Reservado' : 'Comprar oro'}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Móvil: tarjetas */}
              <ul className="divide-y divide-stone-800 md:hidden">
                {visibles.map((lote) => {
                  const nombre = nombreVendedor.get(lote.venta!.vendedor) ?? acortar(lote.venta!.vendedor, 5);
                  return (
                    <li key={lote.lote_id} className="p-4">
                      <div className="flex items-center gap-3">
                        <Avatar nombre={nombre} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{nombre}</p>
                          <p className="font-mono text-xs text-stone-500">{lote.lote_id}</p>
                        </div>
                        <span className="rounded bg-yellow-400/15 px-2 py-0.5 text-xs font-semibold text-yellow-300 ring-1 ring-yellow-400/30">Au</span>
                      </div>
                      <div className="mt-3 flex items-end justify-between gap-3">
                        <div className="text-xs text-stone-400">
                          <p>Ley <span className="font-mono font-semibold text-emerald-400">{formatoPureza(lote.venta!.pureza_bps)} %</span></p>
                          <p>Cantidad <span className="font-mono text-stone-200">{formatoCantidad(lote.peso_kg)}</span></p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-lg font-bold">{formatoPrecio(totalDe(lote).toString(), info.token)}</p>
                          <Link to={`/mercado/${lote.lote_id}`} className="mt-1 inline-block rounded-md bg-emerald-500 px-5 py-2 text-sm font-bold text-stone-950">Comprar</Link>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>

        {/* Cómo funciona */}
        <ol className="mt-6 grid gap-3 text-sm md:grid-cols-3">
          {[
            ['1', 'Elige un lote de oro', 'Cada lote tiene su ley certificada por un laboratorio y anclada en Stellar.'],
            ['2', 'Paga en garantía', `Firmas con Freighter; los ${token?.simbolo ?? 'fondos'} quedan retenidos en el contrato, no en el vendedor.`],
            ['3', 'Confirma y libera', 'Cuando recibes el oro lo confirmas y el pago llega al vendedor.'],
          ].map(([n, titulo, texto]) => (
            <li key={n} className="flex gap-3 rounded-xl bg-stone-900 p-4 ring-1 ring-stone-800">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-mineral-500 font-bold text-stone-950">{n}</span>
              <div><p className="font-semibold text-white">{titulo}</p><p className="mt-0.5 text-stone-400">{texto}</p></div>
            </li>
          ))}
        </ol>

        {/* Vendedores */}
        <section className="mt-10" aria-labelledby="directorio-vendedores">
          <h2 id="directorio-vendedores" className="text-lg font-bold">Vendedores de oro</h2>
          <p className="mt-1 text-xs text-stone-500">El análisis firmado no verifica por sí solo la identidad comercial del vendedor.</p>
          {anuncios.error && <p role="alert" className="mt-3 text-sm text-amber-400">No se pudieron actualizar las publicaciones: {anuncios.error}</p>}
          {vendedoresOro.length > 0 && (
            <div className="mt-4 grid gap-4 text-stone-900 md:grid-cols-2 lg:grid-cols-3">
              {vendedoresOro.map((vendedor) => <TarjetaVendedor key={vendedor.id} vendedor={vendedor} />)}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
