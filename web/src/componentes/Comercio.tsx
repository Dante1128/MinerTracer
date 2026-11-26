import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router';
import { dinero, fechaComercial, importeHumano, mensajeError, pedirComercio, prepararPublicacion, unidadesHumanas, useBorradores, useComercio, useConexion, useConsultaComercial, resumenImportes, type AnuncioComercial, type CotizacionComercial, type PoliticaComercial } from '../comercio.tsx';
import { useWallet } from '../wallet.tsx';
import { formatoPlazo } from '../mercado.ts';

export function IconoComercio({ tipo = 'flecha', className = 'h-5 w-5' }: { tipo?: 'flecha' | 'escudo' | 'moneda' | 'lote' | 'buscar' | 'conexion'; className?: string }) {
  const trazos = {
    flecha: <path d="M4 12h16m-6-6 6 6-6 6" />,
    escudo: <><path d="m12 3 8 3v5c0 5-8 10-8 10S4 16 4 11V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    moneda: <><circle cx="12" cy="12" r="9" /><path d="M15 8h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9m3-10v12" /></>,
    lote: <><path d="m3 8 9-5 9 5-9 5-9-5Zm0 0v9l9 5 9-5V8M12 13v9M7 6l9 5" /></>,
    buscar: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    conexion: <><path d="M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0m-9 4a4 4 0 0 1 6 0" /><circle cx="12" cy="20" r=".5" /></>,
  };
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{trazos[tipo]}</svg>;
}

export function CabeceraComercio({ titulo, texto, accion, volver }: { titulo: string; texto?: string; accion?: ReactNode; volver?: string }) {
  const referencia = useRef<HTMLHeadingElement>(null);
  useEffect(() => { referencia.current?.focus({ preventScroll: true }); }, []);
  return <div className="flex flex-wrap items-end justify-between gap-5">
    <div className="max-w-2xl">{volver && <Link to={volver} className="mb-4 inline-block text-sm font-medium text-stone-500 hover:text-stone-900">← Volver</Link>}
      <h1 ref={referencia} tabIndex={-1} className="text-3xl font-semibold tracking-tight outline-none sm:text-4xl">{titulo}</h1>
      {texto && <p className="mt-3 leading-relaxed text-stone-600">{texto}</p>}
    </div>{accion}
  </div>;
}

export function HeroComercio({ compacto = false }: { compacto?: boolean }) {
  const { datos: politica } = useConsultaComercial<PoliticaComercial>('/politica');
  return <section className="comercio-hero relative overflow-hidden bg-stone-900 text-white">
    <div className={`relative mx-auto grid max-w-6xl gap-10 px-4 ${compacto ? 'py-10 md:py-14' : 'py-16 md:grid-cols-[1.15fr_1fr] md:py-24'}`}>
      <div><p className="mb-4 flex items-center gap-2 text-xs font-semibold tracking-[.18em] text-amber-300 uppercase"><span className="h-1.5 w-1.5 rounded-full bg-amber-300" /> Del origen al acuerdo</p>
        <h1 className={`${compacto ? 'max-w-3xl text-3xl md:text-4xl' : 'text-4xl md:text-6xl'} font-semibold leading-[1.08] tracking-tight text-balance`}>Su oro. Su precio.<br /><span className="text-amber-300">Un acuerdo claro.</span></h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-stone-300 md:text-lg">Compre y venda directamente. Compare cuánto recibe y cuánto paga, acuerde la entrega y siga su operación en un solo lugar.</p>
        <div className="mt-8 flex flex-wrap gap-3"><Link to="/comercio?tipo=venta" className="boton-primario px-6 py-3 text-base">Quiero comprar <IconoComercio /></Link><Link to="/comercio/nuevo?tipo=venta" className="boton border-2 border-stone-600 bg-stone-900 px-6 py-3 text-base text-white hover:border-stone-400 hover:bg-stone-800">Quiero vender</Link></div>
        <Link to="/mercado" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-mineral-400 underline underline-offset-4 hover:text-mineral-100">Elegir un vendedor <IconoComercio /></Link>
        <p className="mt-5 text-xs leading-relaxed text-stone-400">Pruebas en Stellar Testnet. Las publicaciones expresan ofertas de sus participantes; revise la documentación del origen y el ensayo de cada lote.</p>
      </div>
      {!compacto && <div className="relative self-center rounded-2xl border-2 border-stone-700 bg-stone-800/60 p-6 shadow-[var(--shadow-dura)] sm:p-8">
        <div className="mb-7 flex items-center justify-between"><span className="text-sm text-stone-300">Condiciones del servicio</span><IconoComercio tipo="escudo" className="h-6 w-6 text-amber-300" /></div>
        <div className="grid grid-cols-2 gap-6"><div><p className="text-sm text-stone-400">Comisión al vendedor</p><p className="mt-2 text-5xl font-semibold tracking-tight">0<span className="text-2xl text-amber-300">%</span></p></div><div><p className="text-sm text-stone-400">Comisión al comprador</p><p className="mt-2 text-5xl font-semibold tracking-tight">{politica ? dinero(politica.comision_bps / 100) : '1'}<span className="text-2xl text-amber-300">%</span></p></div></div>
        <div className="mt-7 rounded-2xl border border-stone-700 bg-stone-800/70 p-4"><p className="flex items-center gap-2 font-medium text-amber-200"><IconoComercio tipo="moneda" /> Ayuda para su ensayo</p><p className="mt-2 text-sm leading-relaxed text-stone-300">Hasta el {politica ? dinero(politica.reintegro_bps / 100) : '0,25'}% de la venta, con un límite de {politica ? dinero(politica.reintegro_maximo, politica.token?.simbolo ?? 'token') : '100 unidades del token'}. Sujeta al costo acreditado por un laboratorio y a la liquidación final.</p></div>
        <p className="mt-4 text-xs leading-relaxed text-stone-400">{politica ? `Comisión mínima al comprador: ${dinero(politica.comision_minima, politica.token?.simbolo ?? 'token')}. ${politica.origen === 'orientativa' ? 'Propuesta orientativa; el contrato comercial todavía no está disponible.' : 'Condiciones leídas del contrato antes de operar.'}` : 'Condiciones orientativas. Revise el desglose vigente antes de firmar.'}</p>
      </div>}
    </div>
  </section>;
}

export function AccesoComercial({ children }: { children: ReactNode }) {
  const sesion = useComercio(); const wallet = useWallet(); const conectado = useConexion();
  if (sesion.cargando) return <EsqueletoComercio cantidad={1} />;
  if (sesion.cuenta) return <>{children}</>;
  return <section className="tarjeta border-amber-200 p-6" aria-label="Acceso a comercio"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold">Su cuenta para comprar y vender</h2><p className="mt-1 max-w-xl text-sm leading-relaxed text-stone-600">Conecte Freighter e inicie sesión con una firma. Sus publicaciones y acuerdos quedan asociados a su cuenta.</p></div><button className="boton-primario" disabled={sesion.ocupado || wallet.conectando || !conectado} onClick={() => void sesion.iniciar()}>{sesion.ocupado || wallet.conectando ? 'Abriendo Freighter…' : !wallet.direccion ? 'Conectar Freighter' : 'Iniciar sesión'}</button></div>{!conectado && <p className="mt-3 text-sm text-amber-800">Sin conexión. Puede preparar y guardar un borrador; publíquelo cuando vuelva la conexión.</p>}{wallet.instalada === false && <a href="https://www.freighter.app/" target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-amber-800 underline">Instalar Freighter ↗</a>}{(sesion.error || wallet.error) && <p role="alert" className="mt-3 text-sm text-red-700">{sesion.error || wallet.error}</p>}</section>;
}

export function BarraComercio() {
  const conectado = useConexion(); const sesion = useComercio();
  return <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><div className="flex flex-wrap gap-4"><Link className="font-medium hover:text-amber-700" to="/comercio">Publicaciones</Link><Link className="font-medium hover:text-amber-700" to="/operaciones">Mis operaciones</Link><Link className="font-medium hover:text-amber-700" to="/comercio/perfil">Mi perfil</Link>{sesion.cuenta && <Link className="text-stone-500 hover:text-stone-900" to="/revision">Revisión</Link>}</div><span className={`flex items-center gap-1.5 text-xs ${conectado ? 'text-stone-500' : 'font-medium text-amber-800'}`}><span className={`h-1.5 w-1.5 rounded-full ${conectado ? 'bg-emerald-500' : 'bg-amber-500'}`} />{conectado ? sesion.perfil?.nombre ?? 'Conectado' : 'Sin conexión · borradores disponibles'}</span></div>;
}

export function ErrorComercio({ mensaje, reintentar }: { mensaje: string; reintentar?: () => void }) {
  return <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800"><p className="text-sm">{mensaje}</p>{reintentar && <button className="boton-secundario mt-3" onClick={reintentar}>Reintentar</button>}</div>;
}
export function VacioComercio({ titulo, texto, accion }: { titulo: string; texto: string; accion?: ReactNode }) {
  return <section className="tarjeta flex flex-col items-center border-dashed px-6 py-14 text-center"><span className="mb-4 rounded-2xl bg-stone-100 p-4 text-stone-500"><IconoComercio tipo="lote" className="h-7 w-7" /></span><h2 className="text-lg font-semibold">{titulo}</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-stone-500">{texto}</p>{accion && <div className="mt-5">{accion}</div>}</section>;
}
export function EsqueletoComercio({ cantidad = 3 }: { cantidad?: number }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Cargando información"><span className="sr-only">Cargando…</span>{Array.from({ length: cantidad }, (_, indice) => <div key={indice} className="tarjeta animate-pulse space-y-4 p-6"><div className="h-5 w-20 rounded bg-stone-200" /><div className="h-7 w-3/4 rounded bg-stone-100" /><div className="h-4 w-1/2 rounded bg-stone-100" /><div className="h-16 rounded-xl bg-stone-100" /></div>)}</div>;
}

export function TarjetaAnuncio({ anuncio, politica }: { anuncio: AnuncioComercial; politica?: PoliticaComercial | null }) {
  const importes = resumenImportes(anuncio, anuncio.token, politica);
  return <article className="tarjeta group flex h-full flex-col p-5 transition hover:border-mineral-600 sm:p-6">
    <div className="flex items-center justify-between gap-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${anuncio.tipo === 'venta' ? 'bg-amber-50 text-amber-800' : 'bg-sky-50 text-sky-800'}`}>{anuncio.tipo === 'venta' ? 'En venta' : 'Busco comprar'}</span><span className="text-xs text-stone-500">{anuncio.zona}</span></div>
    <h2 className="mt-5 text-xl font-semibold tracking-tight"><Link to={`/comercio/anuncios/${anuncio.id}`} className="hover:text-mineral-700">{anuncio.cantidad} kg de {anuncio.mineral}</Link></h2>
    <p className="mt-2 text-sm text-stone-600"><Link to={`/mercado/vendedor/${anuncio.cuenta}`} className="underline underline-offset-4 hover:text-mineral-700">{anuncio.perfil?.organizacion || anuncio.perfil?.nombre || 'Ver perfil del participante'}</Link></p>
    <div className="my-5 rounded-xl bg-stone-50 p-4"><p className="text-xs text-stone-500">Precio total propuesto</p><p className="mt-1 text-2xl font-semibold tabular-nums">{dinero(anuncio.precio, anuncio.token.simbolo)}</p><p className="mt-2 text-xs text-stone-500">Vendedor recibe, antes de ayuda al ensayo: <span className="font-medium text-stone-700">{dinero(importes.neto, anuncio.token.simbolo)}</span></p>{importes.total && <p className="mt-2 text-xs text-stone-500">Total del comprador: <span className="font-medium text-stone-700">{dinero(importes.total, anuncio.token.simbolo)}</span></p>}</div>
    <dl className="mb-5 space-y-2 text-xs text-stone-500"><div className="flex justify-between gap-3"><dt className="shrink-0">Entrega</dt><dd className="min-w-0 text-right text-stone-700">{anuncio.punto_entrega || 'A convenir'}</dd></div><div className="flex justify-between gap-3"><dt className="shrink-0">Válida hasta</dt><dd className="min-w-0 text-right">{fechaComercial(anuncio.vence)}</dd></div></dl>
    <Link to={`/comercio/anuncios/${anuncio.id}`} className="boton-secundario mt-auto w-full justify-between">{anuncio.tipo === 'venta' ? 'Ver y hacer una oferta' : 'Ver y ofrecer mi lote'}<IconoComercio /></Link>
  </article>;
}

export function DesgloseComercial({ cotizacion, simbolo = '', error, cargando = false, ayudaAcreditada }: {
  cotizacion: CotizacionComercial | null; simbolo?: string; error?: string | null; cargando?: boolean;
  ayudaAcreditada?: { unidades: string; decimales: number };
}) {
  if (error) return <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900" role="status">{error} El desglose se actualizará al recuperar conexión.</p>;
  if (!cotizacion) return <div className="rounded-2xl bg-stone-50 p-5 text-sm text-stone-500" aria-live="polite">{cargando ? 'Calculando los importes…' : 'Ingrese un precio para ver cuánto recibe el vendedor y cuánto paga el comprador.'}</div>;
  const ayuda = ayudaAcreditada ? BigInt(ayudaAcreditada.unidades) : 0n;
  const decimales = ayudaAcreditada?.decimales ?? 7;
  const neto = ayudaAcreditada ? importeHumano(unidadesHumanas(cotizacion.precio, decimales) - unidadesHumanas(cotizacion.gastos_ensayo, decimales) - unidadesHumanas(cotizacion.gastos_traslado, decimales) + ayuda, decimales) : cotizacion.neto_vendedor_sin_reintegro;
  const diferenciaOriginal = cotizacion.diferencia_oferta_externa;
  const diferencia = diferenciaOriginal !== null && ayudaAcreditada
    ? importeHumano(unidadesHumanas(diferenciaOriginal.replace(/^-/, ''), decimales) * (diferenciaOriginal.startsWith('-') ? -1n : 1n) + ayuda, decimales)
    : diferenciaOriginal;
  return <section className="rounded-2xl border border-stone-200 bg-white p-5" aria-label="Desglose del acuerdo" aria-live="polite">
    <h3 className="mb-4 font-semibold">Sus números, por adelantado</h3>
    <dl className="space-y-3 text-sm">
      <div className="flex justify-between gap-3"><dt className="text-stone-500">Precio acordado</dt><dd className="font-medium tabular-nums">{dinero(cotizacion.precio, simbolo)}</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-stone-500">Comisión al comprador</dt><dd className="tabular-nums">{dinero(cotizacion.comision, simbolo)}</dd></div>
      <div className="flex justify-between gap-3 border-t border-stone-100 pt-3"><dt className="font-semibold">Total del comprador</dt><dd className="font-semibold tabular-nums">{dinero(cotizacion.total_comprador, simbolo)}</dd></div>
      <div className="flex justify-between gap-3 pt-2"><dt className="text-stone-500">Ensayo a cargo del vendedor</dt><dd className="tabular-nums">− {dinero(cotizacion.gastos_ensayo, simbolo)}</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-stone-500">Traslado a cargo del vendedor</dt><dd className="tabular-nums">− {dinero(cotizacion.gastos_traslado, simbolo)}</dd></div>
      {ayudaAcreditada && <div className="flex justify-between gap-3 text-emerald-800"><dt>Ayuda al ensayo acreditada</dt><dd className="tabular-nums">+ {dinero(importeHumano(ayuda, decimales), simbolo)}</dd></div>}
      <div className="flex justify-between gap-3 rounded-xl bg-emerald-50 p-3 text-emerald-900"><dt className="font-semibold">Neto del vendedor{ayuda > 0n ? ' con ayuda' : ''}</dt><dd className="font-semibold tabular-nums">{dinero(neto, simbolo)}</dd></div>
      {!ayudaAcreditada && <div className="flex justify-between gap-3 text-xs text-stone-600"><dt>Ayuda al ensayo pendiente de acreditar</dt><dd className="text-right">Hasta {dinero(cotizacion.reintegro_maximo_estimado, simbolo)}</dd></div>}
    </dl>
    <p className="mt-3 text-xs leading-relaxed text-stone-500">{ayudaAcreditada ? 'El contrato registró este importe de ayuda; solo se paga si la venta se liquida a favor del vendedor.' : 'La ayuda al ensayo se limita al costo acreditado y se liquida al cerrar la venta. No se suma al neto hasta su aprobación.'} Los otros gastos y deducciones aplicables deben quedar acordados entre las partes.</p>
    {diferencia !== null && <p className="mt-4 border-t border-stone-100 pt-3 text-sm">Diferencia frente a su oferta externa neta: <strong>{dinero(diferencia, simbolo)}</strong><span className="mt-1 block text-xs text-stone-500">Comparación con el importe introducido por usted, para este mismo lote.</span></p>}
  </section>;
}

export function CampoComercio({ titulo, nombre, ayuda, error, children }: { titulo: string; nombre: string; ayuda?: string; error?: string; children: ReactNode }) {
  const descripcion = [ayuda ? `${nombre}-ayuda` : '', error ? `${nombre}-error` : ''].filter(Boolean).join(' ') || undefined;
  const campo = isValidElement(children) ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string; 'aria-invalid'?: boolean }>, { 'aria-describedby': descripcion, 'aria-invalid': !!error }) : children;
  return <div className="min-w-0"><label className="etiqueta" htmlFor={nombre}>{titulo}</label>{campo}{ayuda && <p id={`${nombre}-ayuda`} className="mt-1.5 text-xs leading-relaxed text-stone-500">{ayuda}</p>}{error && <p id={`${nombre}-error`} className="mt-1.5 text-xs text-red-700" role="alert">{error}</p>}</div>;
}

export function BorradoresComercio({ alSincronizar }: { alSincronizar?: () => void }) {
  const { borradores, quitar, error: errorGuardado } = useBorradores(); const sesion = useComercio(); const conectado = useConexion();
  const [ocupado, setOcupado] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [mensaje, setMensaje] = useState<string | null>(null);
  if (!borradores.length && !errorGuardado && !mensaje && !error) return null;
  const publicar = async (id: string) => {
    const borrador = borradores.find((valor) => valor.id === id); if (!borrador) return;
    setOcupado(id); setError(null); setMensaje(null);
    try { await pedirComercio('/anuncios', { json: prepararPublicacion(borrador.datos, id) }); quitar(id); alSincronizar?.(); setMensaje('Publicación sincronizada correctamente. Actualice la lista para verla.'); }
    catch (e) { setError(mensajeError(e)); }
    finally { setOcupado(null); }
  };
  return <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5"><h2 className="font-semibold">Borradores de este dispositivo</h2><p className="mt-1 text-xs leading-relaxed text-stone-600">Se conservan en este navegador. Solo se publican cuando usted pulsa sincronizar; no contienen datos de contacto ni documentos privados.</p><div className="mt-4 space-y-3">{borradores.map((borrador) => <div key={borrador.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-3"><div><p className="text-sm font-medium">{borrador.datos.tipo === 'venta' ? 'Venta' : 'Compra'} · {borrador.datos.cantidad || '—'} kg · {borrador.datos.zona || 'Sin zona'}</p><p className="mt-1 text-xs text-stone-500">Guardado {fechaComercial(borrador.actualizado_en)}</p></div><div className="flex flex-wrap gap-2"><Link to={`/comercio/nuevo?borrador=${borrador.id}`} className="boton-secundario">Editar</Link><button className="boton-primario" disabled={!sesion.cuenta || !conectado || !!ocupado} onClick={() => void publicar(borrador.id)}>{ocupado === borrador.id ? 'Sincronizando…' : 'Sincronizar publicación'}</button><button className="boton text-stone-500 hover:text-red-700" onClick={() => quitar(borrador.id)} disabled={!!ocupado}>Descartar</button></div></div>)}</div>{(error || errorGuardado) && <p role="alert" className="mt-3 text-sm text-red-700">{error || errorGuardado}</p>}{mensaje && <p role="status" className="mt-3 text-sm text-emerald-800">{mensaje}</p>}{!sesion.cuenta && <p className="mt-3 text-xs text-stone-600">Inicie sesión para sincronizar un borrador.</p>}</section>;
}

export function CondicionesServicio() {
  const { datos } = useConsultaComercial<PoliticaComercial>('/politica');
  return <p className="text-xs leading-relaxed text-stone-500">{datos?.mensaje ?? 'Antes de pagar verá los importes y las condiciones vigentes del servicio.'}{datos?.token && ` Moneda de prueba: ${datos.token.simbolo}.`}{datos?.origen === 'orientativa' && ' Cálculo orientativo; las operaciones requieren que el contrato esté disponible.'}</p>;
}

export function PlazosComerciales({ politica }: { politica: PoliticaComercial }) {
  return <div className="rounded-xl bg-stone-100 p-4 text-xs leading-relaxed text-stone-600"><p className="font-semibold text-stone-800">Plazos que protegen el acuerdo</p>{politica.plazo_entrega_seg && politica.plazo_garantia_seg ? <p className="mt-2">Entrega: {formatoPlazo(Number(politica.plazo_entrega_seg))} desde el pago. Revisión: {formatoPlazo(Number(politica.plazo_garantia_seg))} desde la recepción registrada. Un texto de la publicación no modifica estos plazos del contrato.</p> : <p className="mt-2">Los plazos de entrega y revisión se mostrarán cuando el contrato comercial esté disponible. No se podrá pagar hasta conocerlos.</p>}</div>;
}
