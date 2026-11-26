import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ErrorApi, type AnuncioComercial, type PerfilPublico, type PoliticaComercial } from '../api.ts';
import { TarjetaAnuncio } from '../componentes/Comercio.tsx';
import { TarjetaLote } from '../componentes/Mercado.tsx';
import { useConsultaComercial } from '../comercio.tsx';
import { acortar } from '../formato.ts';
import { agruparPorVendedor, useInfoMercado, useLotesMercado } from '../mercado.ts';

export function PerfilVendedor() {
  const { id = '' } = useParams();
  const info = useInfoMercado();
  const [recarga, setRecarga] = useState(0);
  const { lotes, error } = useLotesMercado(info?.habilitado, recarga);
  const vendedor = agruparPorVendedor(lotes ?? []).find((cuenta) => cuenta.id === id);
  const [perfil, setPerfil] = useState<PerfilPublico | null>(null);
  const [anuncios, setAnuncios] = useState<AnuncioComercial[] | null>(null);
  const [errorPerfil, setErrorPerfil] = useState<string | null>(null);
  const [errorAnuncios, setErrorAnuncios] = useState<string | null>(null);
  const politica = useConsultaComercial<PoliticaComercial>('/politica');
  const cuentaValida = /^G[A-Z2-7]{55}$/.test(id);

  useEffect(() => {
    let vigente = true;
    setPerfil(null); setAnuncios(null); setErrorPerfil(null); setErrorAnuncios(null);
    if (!cuentaValida) return;
    void api<PerfilPublico>(`/mercado/cuentas/${encodeURIComponent(id)}/perfil`, { notificarSesion: false })
      .then((datos) => { if (vigente) setPerfil(datos); })
      .catch((fallo: unknown) => {
        if (vigente && !(fallo instanceof ErrorApi && fallo.estado === 404)) setErrorPerfil('No se pudo actualizar el perfil declarado.');
      });
    void api<{ anuncios: AnuncioComercial[] }>(`/comercio/anuncios?cuenta=${encodeURIComponent(id)}`, { notificarSesion: false })
      .then((datos) => { if (vigente) setAnuncios(datos.anuncios.filter((anuncio) => anuncio.cuenta === id && anuncio.vigente)); })
      .catch((fallo: unknown) => { if (vigente) setErrorAnuncios(fallo instanceof Error ? fallo.message : 'No se pudieron actualizar las publicaciones.'); });
    return () => { vigente = false; };
  }, [id, cuentaValida, recarga]);

  const reintentar = () => setRecarga((valor) => valor + 1);
  const nombre = perfil?.organizacion || perfil?.nombre || vendedor?.nombre || acortar(id, 6);
  if (!cuentaValida) return <div className="mx-auto max-w-xl space-y-5 px-4 py-16 text-center">
    <h1 className="text-2xl font-bold">La cuenta vendedora no es válida</h1>
    <Link to="/comercio" className="boton-primario">Ver publicaciones</Link>
  </div>;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Link to="/mercado" className="text-sm text-stone-500 hover:text-stone-800">← Directorio de vendedores</Link>
      <header className="mt-3">
        <p className="text-xs font-semibold tracking-widest text-mineral-700 uppercase">Perfil comercial</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{nombre}</h1>
        <p className="mt-2 font-mono text-xs break-all text-stone-500">{id}</p>
        {perfil && <p className="mt-3 text-sm text-stone-600">{perfil.nombre}{perfil.zona && ` · ${perfil.zona}`}</p>}
        <p className="mt-3 max-w-3xl text-sm text-stone-600">{perfil ? 'Perfil declarado por esta cuenta; identidad comercial no verificada.' : vendedor?.es_demo ? 'Nombre de demostración; identidad comercial no verificada.' : 'La cuenta y sus lotes no acreditan por sí solos una identidad comercial.'} Consulte el informe del lote y acuerde las condiciones antes de pagar.</p>
        {errorPerfil && <p role="status" className="mt-3 text-sm text-amber-800">{errorPerfil}</p>}
        <div className="mt-5 flex flex-wrap gap-3">
          <Link to="/comercio" className="boton-primario">Comparar ofertas en el mercado P2P</Link>
          <button onClick={reintentar} className="boton-secundario">Actualizar publicaciones</button>
        </div>
      </header>

      <section className="mt-10" aria-labelledby="publicaciones-vendedor">
        <h2 id="publicaciones-vendedor" className="text-xl font-bold tracking-tight">Publicaciones para negociar</h2>
        <p className="mt-2 text-sm text-stone-600">Puede enviar una propuesta antes de que el vendedor reserve el lote en el contrato.</p>
        {errorAnuncios ? <div role="alert" className="tarjeta mt-4 space-y-3 p-5"><p>{errorAnuncios}</p><button className="boton-secundario" onClick={reintentar}>Reintentar</button></div>
          : anuncios === null ? <p role="status" className="mt-5 text-sm text-stone-500">Buscando publicaciones…</p>
          : anuncios.length ? <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">{anuncios.map((anuncio) => <TarjetaAnuncio key={anuncio.id} anuncio={anuncio} politica={politica.datos} />)}</div>
          : <p className="tarjeta mt-5 p-5 text-sm text-stone-600">Esta cuenta no tiene publicaciones abiertas por ahora. <Link to="/comercio" className="font-semibold text-mineral-700 underline">Explorar otras publicaciones</Link></p>}
      </section>

      <section className="mt-12" aria-labelledby="lotes-vendedor">
        <h2 id="lotes-vendedor" className="text-xl font-bold tracking-tight">Lotes con una venta preparada</h2>
        {info === null ? <p role="status" className="mt-5 text-sm text-stone-500">Comprobando el contrato…</p>
          : !info.habilitado ? <p className="tarjeta mt-5 p-5 text-sm text-stone-600">Necesita una conexión al contrato de Stellar para consultar las ventas preparadas.</p>
          : error ? <div role="alert" className="tarjeta mt-5 space-y-3 p-5"><p>{error}</p><button className="boton-secundario" onClick={reintentar}>Reintentar</button></div>
          : lotes === null ? <p role="status" className="mt-5 text-sm text-stone-500">Leyendo las ventas del contrato…</p>
          : !vendedor?.lotes.length ? <p className="tarjeta mt-5 p-5 text-sm text-stone-600">Esta cuenta no tiene lotes con una venta preparada en este momento. Sus publicaciones abiertas aparecen arriba.</p>
          : <>
            <p className="mt-3 text-sm text-stone-600">{vendedor.lotes.length} {vendedor.lotes.length === 1 ? 'lote en venta' : 'lotes en venta'}{vendedor.minerales.length > 0 && ` · ${vendedor.minerales.join(' · ')}`}</p>
            {vendedor.laboratorios.length > 0 && <p className="mt-1 text-sm text-stone-500">Informes firmados por {vendedor.laboratorios.join(' · ')}</p>}
            <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">{vendedor.lotes.map((lote) => <TarjetaLote key={lote.lote_id} lote={lote} token={info.token} />)}</div>
          </>}
      </section>
    </div>
  );
}
