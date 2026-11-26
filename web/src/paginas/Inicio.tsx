import { Link } from 'react-router';
import { CondicionesServicio, HeroComercio, IconoComercio } from '../componentes/Comercio.tsx';

const pasos = [
  { titulo: 'Publique o encuentre un lote', texto: 'Indique el precio total, el lugar y las condiciones de entrega. Puede preparar su publicación sin conexión.' },
  { titulo: 'Acuerden los números', texto: 'Envíe propuestas, responda con otro precio y compare el neto del vendedor con el total del comprador.' },
  { titulo: 'Pague y siga la entrega', texto: 'El comprador deposita el total. La operación muestra quién debe actuar y conserva los respaldos del acuerdo.' },
  { titulo: 'Revise y cierre la compra', texto: 'La recepción inicia el plazo de revisión. Confirme la compra o registre una incidencia para detener el cobro mientras se resuelve.' },
];
const pasosVerificacion = [
  { titulo: 'El laboratorio registra', texto: 'El analista ingresa los resultados y adjunta el informe PDF desde su portal.' },
  { titulo: 'El informe recibe una huella', texto: 'Se vinculan los datos del lote, los resultados y el PDF para detectar cambios posteriores.' },
  { titulo: 'El laboratorio firma', texto: 'Su wallet firma el registro en Stellar. Las correcciones crean versiones nuevas con historial.' },
  { titulo: 'Cualquiera verifica', texto: 'El QR permite consultar el informe y comprobar su integridad contra el registro del contrato.' },
];
export function Inicio() {
  return <>
    <HeroComercio />
    <section className="mx-auto max-w-6xl px-4 py-14 md:py-20">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div><p className="text-xs font-semibold tracking-widest text-amber-700 uppercase">Todo a la vista</p><h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">De la propuesta al cobro,<br />sin perder el hilo.</h2></div>
        <Link to="/comercio" className="boton-secundario">Explorar publicaciones <IconoComercio /></Link>
      </div>
      <ol className="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{pasos.map((paso, indice) => <li key={paso.titulo} className={`tarjeta p-6 ${indice === 2 ? 'bg-mineral-600' : indice === 3 ? 'border-l-4 border-l-mineral-500 bg-stone-900 text-white' : ''}`}><span className={`text-xs font-bold tracking-widest ${indice === 3 ? 'text-mineral-400' : 'text-stone-900'}`}>PASO {indice + 1}</span><h3 className="mt-5 text-lg font-bold leading-snug">{paso.titulo}</h3><p className={`mt-3 text-sm leading-relaxed ${indice === 3 ? 'text-stone-300' : indice === 2 ? 'text-stone-900' : 'text-stone-600'}`}>{paso.texto}</p></li>)}</ol>
      <div className="mt-14 grid gap-5 md:grid-cols-2">
        <section className="tarjeta border-amber-200 bg-amber-50/40 p-7"><IconoComercio tipo="moneda" className="h-7 w-7 text-amber-700" /><h2 className="mt-4 text-xl font-semibold">Una mejor oferta se demuestra en el neto.</h2><p className="mt-3 text-sm leading-relaxed text-stone-600">Ingrese cuánto le ofrece hoy otro comprador por el mismo lote. Compare precio, gastos de ensayo, traslado, lugar de entrega y plazo de pago antes de aceptar.</p><Link to="/comercio/nuevo?tipo=venta" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-amber-900">Preparar mi venta <IconoComercio /></Link></section>
        <section className="tarjeta p-7"><IconoComercio tipo="escudo" className="h-7 w-7 text-stone-600" /><h2 className="mt-4 text-xl font-semibold">Un origen respaldado, un informe comprobable.</h2><p className="mt-3 text-sm leading-relaxed text-stone-600">Consulte el análisis del lote y añada referencias de su origen, entrega y ensayo. La verificación detecta cambios en el informe; la procedencia física requiere respaldos y revisión.</p><Link to="/verificar" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold">Verificar un lote <IconoComercio /></Link></section>
      </div>
      <section className="mt-16 border-t-2 border-stone-200 pt-14" aria-labelledby="inicio-respaldo">
        <div className="grid items-center gap-8 md:grid-cols-2">
          <div><p className="text-xs font-bold tracking-widest text-mineral-700 uppercase">El respaldo del acuerdo</p><h2 id="inicio-respaldo" className="mt-3 text-3xl font-bold tracking-tight">Un análisis que nadie puede alterar sin que se note.</h2><p className="mt-4 leading-relaxed text-stone-600">El precio y la revisión del lote necesitan un informe confiable. MinerTrace conserva la huella de sus datos y del PDF, la firma del laboratorio y las correcciones para que ambas partes puedan comprobar qué se registró.</p><Link to="/verificar" className="boton-secundario mt-6">Verificar un lote <IconoComercio tipo="escudo" /></Link></div>
          <div className="rounded-2xl border-2 border-stone-900 bg-stone-900 p-6 font-mono text-sm text-white shadow-[var(--shadow-dura)]">
            <p className="text-stone-400">Ejemplo ilustrativo · informe de laboratorio</p>
            <p className="mt-4"><span className="text-stone-300">Pureza registrada:</span> <span className="font-semibold text-emerald-400">75,00 %</span></p>
            <p className="mt-2 text-stone-300">Huella original → registro firmado</p>
            <div className="my-5 border-t-2 border-dashed border-stone-700" />
            <p className="text-stone-400">Alguien cambia el dato posteriormente</p>
            <p className="mt-3"><span className="text-stone-300">Pureza modificada:</span> <span className="font-semibold text-red-400">95,00 %</span></p>
            <p className="mt-4 rounded-full border-2 border-red-800 bg-red-600/20 px-3 py-2 font-sans font-semibold text-red-300">✕ La nueva huella revela la alteración</p>
          </div>
        </div>
        <ol className="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{pasosVerificacion.map((paso, indice) => <li key={paso.titulo} className="tarjeta p-5"><p className="text-xs font-bold tracking-widest text-mineral-700">{String(indice + 1).padStart(2, '0')} · VERIFICACIÓN</p><h3 className="mt-3 text-lg font-bold">{paso.titulo}</h3><p className="mt-3 text-sm leading-relaxed text-stone-600">{paso.texto}</p></li>)}</ol>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <section className="tarjeta border-l-4 border-l-emerald-600 p-6"><h3 className="font-bold text-emerald-800">Qué comprueba la verificación</h3><ul className="mt-3 space-y-2 text-sm leading-relaxed text-stone-700"><li>✓ La integridad de los datos y del informe PDF.</li><li>✓ La cuenta del laboratorio firmante y su autorización.</li><li>✓ El historial de versiones y las correcciones enlazadas.</li><li>✓ El registro público al que se vincula el acuerdo comercial.</li></ul></section>
          <section className="tarjeta p-6"><h3 className="font-bold">El respaldo físico también importa</h3><p className="mt-3 text-sm leading-relaxed text-stone-700">La calidad de la muestra y del ensayo depende del laboratorio y sus procedimientos. Documenten el origen, la entrega y la devolución cuando corresponda. La huella protege lo registrado; la procedencia y el movimiento físico requieren revisión de sus respaldos.</p></section>
        </div>
        <div className="tarjeta mt-8 flex flex-wrap items-center justify-between gap-4 bg-mineral-50 p-6"><div><h3 className="font-bold">Pruebe la verificación del informe</h3><p className="mt-1 text-sm text-stone-600">Lote sintético LT-2026-0457 · concentrado de estaño al 75 %.</p></div><Link to="/verificar/LT-2026-0457" className="boton-primario">Verificar lote de ejemplo <IconoComercio /></Link></div>
      </section>
      <div className="mt-10"><CondicionesServicio /></div>
    </section>
  </>;
}
