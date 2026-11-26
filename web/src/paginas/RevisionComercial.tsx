import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { AccesoComercial, CabeceraComercio, ErrorComercio, VacioComercio } from '../componentes/Comercio.tsx';
import { EstadoTransaccion } from '../componentes/Mercado.tsx';
import { mensajeError, montoUnidades, pedirComercio, useConsultaComercial, type DetalleOperacionComercial } from '../comercio.tsx';
import { useTransaccionComercial } from '../mercado.ts';

export function RevisionComercial() {
  return <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
    <CabeceraComercio titulo="Revisión de incidencias" texto="Resuelva cada caso con las evidencias de la operación. La autorización corresponde a la cuenta administradora del contrato." volver="/operaciones" />
    <AccesoComercial><CasosRevision /></AccesoComercial>
  </div>;
}

function CasosRevision() {
  const consulta = useConsultaComercial<{ autorizado: true; operaciones: DetalleOperacionComercial[] }>('/revision?solo_disputas=true');
  if (consulta.error) return <ErrorComercio mensaje={consulta.error} reintentar={consulta.recargar} />;
  if (!consulta.datos) return <p role="status" className="py-8 text-stone-500">Comprobando autorización y buscando incidencias…</p>;
  if (!consulta.datos.operaciones.length) return <VacioComercio titulo="Sin incidencias pendientes" texto="Las operaciones que necesiten una resolución aparecerán aquí." accion={<Link className="boton-secundario" to="/operaciones">Ver mis operaciones</Link>} />;
  return <div className="space-y-5">{consulta.datos.operaciones.map((detalle) => <CasoRevision key={detalle.operacion.id} detalle={detalle} recargar={consulta.recargar} />)}</div>;
}

function CasoRevision({ detalle, recargar }: { detalle: DetalleOperacionComercial; recargar: () => void }) {
  const transaccion = useTransaccionComercial();
  const [reembolsar, setReembolsar] = useState(true);
  const [referencia, setReferencia] = useState('');
  const [motivo, setMotivo] = useState('');
  const [devuelto, setDevuelto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const orden = detalle.operacion;
  const comercial = detalle.cadena?.venta_comercial;
  const exigeDevolucion = !!comercial?.recepcion || !!detalle.cadena?.contra_analisis;
  const resolver = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault(); setError(null);
    try {
      if (motivo.trim().length < 20 || referencia.trim().length < 4) throw new Error('Complete la referencia y explique la resolución con al menos 20 caracteres');
      if (reembolsar && exigeDevolucion && !devuelto) throw new Error('Confirme y documente la devolución antes de autorizar el reembolso');
      const tipo = reembolsar && exigeDevolucion ? 'devolucion' : 'decision';
      const huella = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ orden_id: orden.id, tipo, referencia: referencia.trim(), motivo: motivo.trim(), reembolsar })));
      const hash = Array.from(new Uint8Array(huella), (valor) => valor.toString(16).padStart(2, '0')).join('');
      const evidencia = await pedirComercio<{ id: string; hash: string }>(`/revision/${orden.id}/evidencias`, { json: {
        cliente_id: crypto.randomUUID(), tipo, hash,
        referencia, descripcion: motivo,
      } });
      const resultado = await transaccion.ejecutar({ accion: 'resolver_incidencia', lote_id: orden.lote_id,
        orden_id: orden.id, reembolsar, ...(reembolsar && exigeDevolucion ? { evidencia_id: evidencia.id } : {}) });
      if (resultado) recargar();
    } catch (fallo) { setError(mensajeError(fallo)); }
  };
  return <article className="tarjeta space-y-5 p-5 sm:p-6"><header><h2 className="font-mono text-lg font-semibold">{orden.lote_id}</h2><p className="mt-2 text-sm text-red-700">{comercial?.incidencia?.motivo || 'Discrepancia en el contraanálisis de pureza'}</p></header>
    <dl className="grid gap-4 rounded-xl bg-stone-50 p-4 text-sm sm:grid-cols-3"><div><dt className="text-stone-500">Pago retenido</dt><dd className="mt-1 font-semibold">{montoUnidades(comercial?.total ?? orden.precio_unidades, orden.token)}</dd></div><div><dt className="text-stone-500">Recepción acreditada</dt><dd className="mt-1 font-medium">{comercial?.recepcion ? 'Sí' : 'No'}</dd></div><div><dt className="text-stone-500">Evidencias</dt><dd className="mt-1 font-medium">{detalle.evidencias.length} referencias registradas</dd></div></dl>
    <details className="rounded-xl border border-stone-200 p-4"><summary className="cursor-pointer text-sm font-medium">Consultar evidencias de las partes</summary><ul className="mt-4 space-y-3 text-sm">{detalle.evidencias.map((evidencia) => <li key={evidencia.id}><strong>{evidencia.tipo}: {evidencia.referencia}</strong><p className="mt-1 text-stone-600">{evidencia.descripcion}</p></li>)}</ul></details>
    <form className="space-y-4" onSubmit={(evento) => void resolver(evento)}><fieldset><legend className="etiqueta">Resolución</legend><div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="radio" name={`resolucion-${orden.id}`} checked={reembolsar} onChange={() => setReembolsar(true)} />Reembolsar al comprador</label><label className="flex items-center gap-2"><input type="radio" name={`resolucion-${orden.id}`} checked={!reembolsar} onChange={() => setReembolsar(false)} disabled={!comercial?.recepcion} />Liquidar al vendedor</label></div></fieldset>
      {reembolsar && exigeDevolucion && <label className="flex items-start gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><input type="checkbox" className="mt-1" checked={devuelto} onChange={(evento) => setDevuelto(evento.target.checked)} required />He comprobado la devolución del material y conservo el acta que la respalda.</label>}
      <div><label className="etiqueta" htmlFor={`acta-${orden.id}`}>Referencia del acta de revisión{reembolsar && exigeDevolucion ? ' y devolución' : ''}</label><input id={`acta-${orden.id}`} className="campo" required minLength={4} maxLength={200} value={referencia} onChange={(evento) => setReferencia(evento.target.value)} /></div>
      <div><label className="etiqueta" htmlFor={`motivo-${orden.id}`}>Fundamento de la decisión</label><textarea id={`motivo-${orden.id}`} className="campo" rows={3} required minLength={20} maxLength={2000} value={motivo} onChange={(evento) => setMotivo(evento.target.value)} /></div>
      <button className="boton-primario" disabled={transaccion.ocupado}>{transaccion.ocupado ? 'Esperando la confirmación…' : 'Firmar y aplicar resolución'}</button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </form><EstadoTransaccion paso={transaccion.paso} error={transaccion.error} resultado={transaccion.resultado} />
  </article>;
}
