import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BarraComercio, BorradoresComercio, CabeceraComercio, CondicionesServicio, ErrorComercio, EsqueletoComercio, IconoComercio, TarjetaAnuncio, VacioComercio } from '../componentes/Comercio.tsx';
import { useComercio, useConsultaComercial, type AnuncioComercial, type PoliticaComercial } from '../comercio.tsx';

export function Comercio() {
  const [parametros, cambiarParametros] = useSearchParams(); const sesion = useComercio();
  const [zona, setZona] = useState(''); const [busqueda, setBusqueda] = useState('');
  const tipo = parametros.get('tipo') === 'compra' ? 'compra' : 'venta';
  const propios = parametros.get('propios') === 'true';
  const politica = useConsultaComercial<PoliticaComercial>('/politica');
  const consulta = useConsultaComercial<{ anuncios: AnuncioComercial[] }>(`/anuncios?tipo=${tipo}${propios && sesion.cuenta ? '&propios=true' : ''}`);
  const zonas = [...new Set(consulta.datos?.anuncios.map((valor) => valor.zona) ?? [])].sort();
  const anuncios = consulta.datos?.anuncios.filter((valor) => (!zona || valor.zona === zona) && `${valor.mineral} ${valor.lote_id ?? ''} ${valor.perfil?.organizacion ?? ''}`.toLocaleLowerCase('es').includes(busqueda.toLocaleLowerCase('es')));
  const filtrar = (nuevoTipo: string) => { cambiarParametros({ tipo: nuevoTipo, ...(propios ? { propios: 'true' } : {}) }); setZona(''); };
  return <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:py-12">
    <BarraComercio />
    <CabeceraComercio titulo="Encuentre su próximo acuerdo" texto="Lotes y propuestas directas, con un precio y condiciones que puede comparar antes de decidir." accion={<Link to={`/comercio/nuevo?tipo=${tipo === 'venta' ? 'compra' : 'venta'}`} className="boton-primario py-3">+ Publicar {tipo === 'venta' ? 'una compra' : 'una venta'}</Link>} />
    <BorradoresComercio alSincronizar={consulta.recargar} />
    <section aria-label="Filtros de publicaciones" className="tarjeta p-4 sm:p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4"><div className="inline-flex rounded-xl bg-stone-100 p-1" role="group" aria-label="Qué busca"><button className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${tipo === 'venta' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'}`} aria-pressed={tipo === 'venta'} onClick={() => filtrar('venta')}>Quiero comprar</button><button className={`rounded-lg px-4 py-2.5 text-sm font-semibold transition ${tipo === 'compra' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'}`} aria-pressed={tipo === 'compra'} onClick={() => filtrar('compra')}>Quiero vender</button></div>{sesion.cuenta && <label className="flex items-center gap-2 text-sm text-stone-600"><input type="checkbox" checked={propios} onChange={(evento) => cambiarParametros({ tipo, ...(evento.target.checked ? { propios: 'true' } : {}) })} className="h-4 w-4 accent-amber-600" /> Solo mis publicaciones</label>}</div>
      <div className="grid gap-4 sm:grid-cols-[1fr_240px]"><div className="relative"><label htmlFor="buscar-comercio" className="sr-only">Buscar mineral, lote u organización</label><span className="pointer-events-none absolute top-3 left-3 text-stone-400"><IconoComercio tipo="buscar" /></span><input className="campo py-2.5 pl-10" id="buscar-comercio" placeholder="Buscar mineral, lote u organización" value={busqueda} onChange={(evento) => setBusqueda(evento.target.value)} /></div><div><label htmlFor="zona-comercio" className="sr-only">Zona de entrega</label><select className="campo py-2.5" id="zona-comercio" value={zona} onChange={(evento) => setZona(evento.target.value)}><option value="">Todas las zonas</option>{zonas.map((valor) => <option key={valor}>{valor}</option>)}</select></div></div>
    </section>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{tipo === 'venta' ? 'Lotes en venta' : 'Personas que buscan comprar'}</h2>{anuncios && <span className="text-sm text-stone-500" aria-live="polite">{anuncios.length} {anuncios.length === 1 ? 'publicación' : 'publicaciones'}</span>}</div>
    {consulta.error ? <ErrorComercio mensaje={consulta.error} reintentar={consulta.recargar} /> : consulta.cargando ? <EsqueletoComercio /> : anuncios?.length ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{anuncios.map((anuncio) => <TarjetaAnuncio key={anuncio.id} anuncio={anuncio} politica={politica.datos} />)}</div> : <VacioComercio titulo="Todavía no hay coincidencias" texto={busqueda || zona ? 'Pruebe otra búsqueda o quite el filtro de zona.' : 'Las publicaciones aparecerán aquí cuando un participante las envíe. Puede crear la primera propuesta.'} accion={<Link to={`/comercio/nuevo?tipo=${tipo === 'venta' ? 'venta' : 'compra'}`} className="boton-primario">Crear una publicación</Link>} />}
    <CondicionesServicio />
  </div>;
}
