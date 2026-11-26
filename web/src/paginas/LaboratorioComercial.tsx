import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../api.ts';
import { montoUnidades, type DetalleOperacionComercial } from '../comercio.tsx';
import { AvisoWallet, EstadoTransaccion } from '../componentes/Mercado.tsx';
import { useTransaccionComercial, type AccionComercial } from '../mercado.ts';
import { useWallet } from '../wallet.tsx';

const mensaje = (error: unknown) => error instanceof Error ? error.message : 'No se pudo cargar la información';

/** Una sola referencia estable evita reutilizar el mismo comprobante para solicitar varios reintegros. */
async function huellaReferencia(cuenta: string, referencia: string, tipo: string, loteId: string) {
  const normalizada = referencia.trim().normalize('NFKC').toLocaleUpperCase('es').replace(/\s+/g, ' ');
  const contenido = tipo === 'registrar_gasto_ensayo'
    ? `MinerTrace comprobante de ensayo\n${cuenta}\n${normalizada}`
    : `MinerTrace evidencia ${tipo}\n${cuenta}\n${loteId}\n${normalizada}`;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(contenido));
  return Array.from(new Uint8Array(hash), (valor) => valor.toString(16).padStart(2, '0')).join('');
}

export function LaboratorioComercial() {
  const [operaciones, setOperaciones] = useState<DetalleOperacionComercial[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    let vigente = true;
    setError(null);
    void api<DetalleOperacionComercial[]>('/comercio/laboratorio/operaciones')
      .then((datos) => { if (vigente) setOperaciones(datos); })
      .catch((fallo) => { if (vigente) setError(mensaje(fallo)); });
    return () => { vigente = false; };
  }, [recarga]);
  return <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
    <header><p className="text-sm font-medium text-amber-800">Portal del laboratorio</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Entregas y ensayos</h1>
      <p className="mt-3 max-w-3xl text-stone-600">Acredite el costo del ensayo y deje constancia de una entrega o devolución que su laboratorio haya comprobado. Cada constancia se firma con la wallet institucional.</p>
    </header>
    <AvisoWallet />
    {error ? <div className="tarjeta p-5"><p role="alert" className="text-red-700">{error}</p><button className="boton-secundario mt-3" onClick={() => setRecarga((valor) => valor + 1)}>Reintentar</button></div>
      : operaciones === null ? <p role="status" className="py-8 text-stone-500">Buscando operaciones de sus lotes…</p>
      : operaciones.length === 0 ? <div className="tarjeta p-8"><h2 className="font-semibold">Sin operaciones por atender</h2><p className="mt-2 text-sm text-stone-600">Aquí aparecerán los acuerdos comerciales de lotes registrados por su laboratorio.</p><Link to="/laboratorio" className="boton-secundario mt-4">Volver a mis análisis</Link></div>
      : operaciones.map((detalle) => <OperacionLaboratorio key={detalle.operacion.id} detalle={detalle} recargar={() => setRecarga((valor) => valor + 1)} />)}
  </div>;
}

function OperacionLaboratorio({ detalle, recargar }: { detalle: DetalleOperacionComercial; recargar: () => void }) {
  const wallet = useWallet();
  const transaccion = useTransaccionComercial();
  const [accion, setAccion] = useState<AccionComercial>('registrar_gasto_ensayo');
  const [referencia, setReferencia] = useState('');
  const [costo, setCosto] = useState(detalle.operacion.condiciones.gastos_ensayo || '');
  const [error, setError] = useState<string | null>(null);
  const orden = detalle.operacion;
  const cadena = detalle.cadena;
  const cuentaCorrecta = wallet.direccion === cadena?.lab;
  const firmar = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault(); setError(null);
    try {
      if (!wallet.direccion || !cuentaCorrecta) throw new Error('Conecte la cuenta del laboratorio que certificó este lote');
      if (referencia.trim().length < 4) throw new Error('Indique el número de comprobante o la referencia del acta');
      const hash = await huellaReferencia(wallet.direccion, referencia, accion, orden.lote_id);
      const resultado = await transaccion.ejecutar({ accion, lote_id: orden.lote_id, orden_id: orden.id,
        evidencia_hash: hash, comprobante_hash: hash, ...(accion === 'registrar_gasto_ensayo' ? { costo } : {}) });
      if (resultado) { setReferencia(''); recargar(); }
    } catch (fallo) { setError(mensaje(fallo)); }
  };
  return <article className="tarjeta space-y-5 p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-mono font-semibold">{orden.lote_id}</h2><p className="mt-1 text-sm text-stone-500">{orden.condiciones.punto_entrega || 'Punto de entrega por acordar'}</p></div><span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium">{cadena?.estado ?? 'Pendiente de firma del vendedor'}</span></div>
    <div className="grid gap-3 rounded-xl bg-stone-50 p-4 text-sm sm:grid-cols-2"><p>Precio acordado <strong className="block">{montoUnidades(orden.precio_unidades, orden.token)}</strong></p><p>Moneda <strong className="block">{orden.token.simbolo} · Testnet</strong></p></div>
    {!cuentaCorrecta && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Elija en Freighter la wallet institucional de este lote para firmar la constancia.</p>}
    <form className="space-y-4" onSubmit={(evento) => void firmar(evento)}>
      <div><label htmlFor={`accion-${orden.id}`} className="etiqueta">¿Qué desea acreditar?</label>
        <select id={`accion-${orden.id}`} className="campo" value={accion} onChange={(evento) => { setAccion(evento.target.value as AccionComercial); setError(null); }}>
          <option value="registrar_gasto_ensayo">El vendedor pagó el ensayo</option>
          <option value="atestiguar_entrega">Se entregó el material al comprador</option>
          <option value="registrar_devolucion">Se devolvió el material al vendedor</option>
        </select></div>
      {accion === 'registrar_gasto_ensayo' && <div><label htmlFor={`costo-${orden.id}`} className="etiqueta">Costo pagado ({orden.token.simbolo})</label><input id={`costo-${orden.id}`} className="campo" inputMode="decimal" required value={costo} onChange={(evento) => setCosto(evento.target.value)} /><p className="mt-1 text-xs text-stone-500">Acredítelo antes de que el vendedor publique la reserva. El reintegro solo se paga cuando la venta se completa.</p></div>}
      <div><label htmlFor={`referencia-${orden.id}`} className="etiqueta">{accion === 'registrar_gasto_ensayo' ? 'Número de comprobante del ensayo' : 'Referencia del acta firmada de entrega o devolución'}</label><input id={`referencia-${orden.id}`} className="campo" required minLength={4} maxLength={200} placeholder="Ej.: FACT-LAB-0042" value={referencia} onChange={(evento) => setReferencia(evento.target.value)} /><p className="mt-1 text-xs text-stone-500">Use la referencia del documento que su laboratorio conserva. La constancia registra su declaración institucional y su huella.</p></div>
      <button className="boton-primario" disabled={transaccion.ocupado || !cuentaCorrecta || !wallet.redCorrecta}>{transaccion.ocupado ? 'Esperando confirmación…' : 'Acreditar con mi laboratorio'}</button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </form>
    <EstadoTransaccion paso={transaccion.paso} error={transaccion.error} resultado={transaccion.resultado} />
  </article>;
}
