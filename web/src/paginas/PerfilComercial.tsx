import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AccesoComercial, BarraComercio, CabeceraComercio, CampoComercio, ErrorComercio } from '../componentes/Comercio.tsx';
import { erroresCampos, mensajeError, pedirComercio, useComercio, type PerfilComercial as DatosPerfil, type TipoParticipante } from '../comercio.tsx';

export function PerfilComercial() {
  return <div className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:py-12"><BarraComercio /><CabeceraComercio titulo="Su perfil comercial" texto="Preséntese a la otra parte. Su nombre, organización y zona aparecen junto a sus publicaciones." /><AccesoComercial><FormularioPerfil /></AccesoComercial></div>;
}
function FormularioPerfil() {
  const sesion = useComercio();
  const [parametros] = useSearchParams();
  const regreso = parametros.get('volver');
  const continuar = regreso?.startsWith('/comercio/nuevo?borrador=') ? regreso : '/comercio/nuevo';
  const [nombre, setNombre] = useState(''); const [organizacion, setOrganizacion] = useState(''); const [tipo, setTipo] = useState<TipoParticipante>('productor'); const [zona, setZona] = useState('');
  const [contacto, setContacto] = useState(''); const [documento, setDocumento] = useState(''); const [error, setError] = useState<string | null>(null); const [errores, setErrores] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false); const [guardado, setGuardado] = useState(false);
  useEffect(() => { const perfil = sesion.perfil; if (perfil) { setNombre(perfil.nombre); setOrganizacion(perfil.organizacion); setTipo(perfil.tipo); setZona(perfil.zona); setContacto(perfil.contacto); setDocumento(perfil.documento_ref); } }, [sesion.perfil]);
  const guardar = async (evento: FormEvent) => {
    evento.preventDefault(); setOcupado(true); setError(null); setGuardado(false); setErrores({});
    try { await pedirComercio<DatosPerfil>('/perfil', { metodo: 'PUT', json: { nombre, organizacion, tipo, zona, contacto, documento_ref: documento } }); await sesion.recargar(); setGuardado(true); }
    catch (e) { setError(mensajeError(e)); setErrores(erroresCampos(e)); }
    finally { setOcupado(false); }
  };
  return <form onSubmit={(evento) => void guardar(evento)} className="tarjeta space-y-6 p-5 sm:p-8">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-stone-50 p-4 text-sm"><span className="min-w-0 text-stone-600">Sesión comercial activa</span><button type="button" className="font-semibold text-stone-700 underline hover:text-stone-950" disabled={sesion.ocupado} onClick={() => void sesion.salir()}>{sesion.ocupado ? 'Cerrando…' : 'Cerrar sesión comercial'}</button>{sesion.error && <p className="w-full text-red-700" role="alert">{sesion.error}</p>}</div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 pb-5"><div><h2 className="text-xl font-semibold">Datos del participante</h2><p className="mt-1 text-sm text-stone-500">Puede actualizarlos sin volver a firmar el inicio de sesión.</p></div><span className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-600">Perfil declarado</span></div>
    <div className="grid gap-5 sm:grid-cols-2"><CampoComercio nombre="perfil-nombre" titulo="Su nombre" error={errores.nombre}><input id="perfil-nombre" className="campo" value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" required maxLength={120} /></CampoComercio><CampoComercio nombre="perfil-organizacion" titulo="Organización o cooperativa" error={errores.organizacion}><input id="perfil-organizacion" className="campo" value={organizacion} onChange={(e) => setOrganizacion(e.target.value)} autoComplete="organization" maxLength={160} /></CampoComercio><CampoComercio nombre="perfil-tipo" titulo="Cómo participa"><select id="perfil-tipo" className="campo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoParticipante)}><option value="productor">Productor</option><option value="cooperativa">Cooperativa</option><option value="comprador">Comprador / comercializador</option></select></CampoComercio><CampoComercio nombre="perfil-zona" titulo="Zona o municipio" error={errores.zona}><input id="perfil-zona" className="campo" value={zona} onChange={(e) => setZona(e.target.value)} placeholder="Por ejemplo, Guanay" required maxLength={120} /></CampoComercio></div>
    <details className="rounded-xl border border-stone-200 p-4"><summary className="cursor-pointer text-sm font-semibold">Contacto y referencia documental privados</summary><p className="mt-3 text-xs leading-relaxed text-stone-500">Se envían al servidor al guardar. No se incluyen en su perfil público ni se guardan como borradores en este dispositivo.</p><div className="mt-4 grid gap-5 sm:grid-cols-2"><CampoComercio nombre="perfil-contacto" titulo="Correo o teléfono de contacto" error={errores.contacto}><input id="perfil-contacto" className="campo" value={contacto} onChange={(e) => setContacto(e.target.value)} autoComplete="off" maxLength={200} /></CampoComercio><CampoComercio nombre="perfil-documento" titulo="Referencia NIM u organización" ayuda="Referencia declarada; su registro no constituye una acreditación." error={errores.documento_ref}><input id="perfil-documento" className="campo" value={documento} onChange={(e) => setDocumento(e.target.value)} autoComplete="off" maxLength={200} /></CampoComercio></div></details>
    {error && <ErrorComercio mensaje={error} />}{guardado && <div role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">Perfil guardado. <Link to={continuar} className="font-semibold underline">Crear mi publicación →</Link></div>}
    <div className="flex flex-wrap items-center justify-between gap-4"><p className="max-w-lg text-xs leading-relaxed text-stone-500">La identidad y documentación son declaraciones del participante. Compruebe los respaldos de cada acuerdo.</p><button disabled={ocupado} className="boton-primario px-6 py-3">{ocupado ? 'Guardando…' : 'Guardar perfil'}</button></div>
  </form>;
}
