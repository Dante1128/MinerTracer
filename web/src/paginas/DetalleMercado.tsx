import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { AvisoWallet, EstadoTransaccion } from '../componentes/Mercado.tsx';
import { AnalisisDelLote, SeccionComercial, useDetalleComercial, useVerificacionLote } from '../componentes/VerificacionLote.tsx';
import { formatoPeso } from '../formato.ts';
import { formatoPrecio, useTransaccion } from '../mercado.ts';
import { useWallet } from '../wallet.tsx';

export function DetalleMercado() {
  const { loteId = '' } = useParams();
  const [recarga, setRecarga] = useState(0);
  const { resultado, error } = useVerificacionLote(loteId);
  const { info, detalle } = useDetalleComercial(loteId, recarga);
  const wallet = useWallet();
  const compra = useTransaccion();

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">{error}</h1>
        <Link to="/mercado" className="boton-primario mt-6">
          Volver al mercado
        </Link>
      </div>
    );
  }
  if (!resultado) return <p className="py-16 text-center text-stone-500">Cargando…</p>;

  const { lote, laboratorio } = resultado;
  const estado = detalle?.estado;
  const venta = estado?.venta;
  const comercial = estado?.venta_comercial;
  const total = comercial?.total ?? venta?.precio;
  const reservadoParaOtro = !!comercial?.comprador_reservado && comercial.comprador_reservado !== wallet.direccion;
  const esVendedor = venta?.vendedor === wallet.direccion;
  const integro = resultado.analisis.length > 0 && resultado.analisis.every((a) => a.vigente.verificacion.estado === 'integro');

  const comprar = async () => {
    if (!venta || !total) return;
    if (await compra.ejecutar('buy', lote.id, undefined, { total_esperado: total, analisis_id_esperado: venta.analisis_id, version_esperada: venta.version, orden_id: comercial?.orden_id ?? undefined })) setRecarga((n) => n + 1);
  };

  const acciones =
    estado?.estado === 'EnVenta' && venta && info?.habilitado ? (
      <div className="space-y-3 border-t border-stone-100 pt-4">
        <AvisoWallet />
        {!integro && (
          <p className="rounded-lg bg-red-50 p-3 text-sm font-medium text-red-700">
            Atención: la verificación del análisis no da "íntegro". Revise la evidencia antes de comprar.
          </p>
        )}
        {esVendedor ? (
          <p className="text-sm text-stone-600">Este lote es suyo: está publicado y espera comprador.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="boton-primario"
              onClick={() => void comprar()}
              disabled={compra.ocupado || !wallet.direccion || !wallet.redCorrecta || !integro || reservadoParaOtro}
            >
              {compra.ocupado ? 'Procesando…' : reservadoParaOtro ? 'Reservado para otro comprador' : `Comprar por ${formatoPrecio(total!, info.token)}`}
            </button>
            <p className="text-xs text-stone-500">
              El pago queda retenido en el contrato hasta que confirme la recepción desde{' '}
              <Link to="/mis-lotes" className="text-mineral-700 hover:underline">
                Mis lotes
              </Link>
              .
            </p>
          </div>
        )}
        {comercial && <dl className="grid gap-3 rounded-xl bg-stone-50 p-4 text-sm sm:grid-cols-3">
          <div><dt className="text-stone-500">Precio del mineral</dt><dd className="mt-1 font-semibold">{formatoPrecio(venta.precio, info.token)}</dd></div>
          <div><dt className="text-stone-500">Comisión del comprador</dt><dd className="mt-1 font-semibold">{formatoPrecio(comercial.comision, info.token)}</dd></div>
          <div><dt className="text-stone-500">Ayuda al ensayo acreditada</dt><dd className="mt-1 font-semibold text-emerald-800">{formatoPrecio(comercial.reintegro, info.token)}</dd></div>
        </dl>}
        {comercial?.orden_id && <Link className="inline-block text-sm font-semibold text-amber-800 underline" to={`/operaciones/${comercial.orden_id}`}>Ver el acuerdo, la entrega y los importes completos →</Link>}
        <EstadoTransaccion paso={compra.paso} error={compra.error} resultado={compra.resultado} />
      </div>
    ) : compra.paso === 'confirmada' ? (
      <div className="border-t border-stone-100 pt-4">
        <EstadoTransaccion paso={compra.paso} error={compra.error} resultado={compra.resultado} />
        <p className="mt-2 text-sm">
          Siga la compra en{' '}
          <Link to="/mis-lotes" className="font-medium text-mineral-700 hover:underline">
            Mis lotes
          </Link>
          .
        </p>
      </div>
    ) : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <Link to="/mercado" className="text-sm text-stone-500 hover:text-stone-800">
        ← Mercado
      </Link>
      <header>
        <h1 className="font-mono text-3xl font-bold">{lote.id}</h1>
        <p className="mt-1 text-stone-600">
          {lote.tipo_mineral} · {formatoPeso(lote.peso_kg)} · {lote.origen}
        </p>
        <p className="mt-1 text-sm text-stone-500">
          Certificado por <strong className="text-stone-700">{laboratorio.nombre}</strong>
          {laboratorio.acreditaciones.length > 0 && ` · ${laboratorio.acreditaciones.join(', ')}`}
        </p>
      </header>

      <SeccionComercial loteId={lote.id} recarga={recarga} acciones={acciones} />
      <AnalisisDelLote resultado={resultado} />
    </div>
  );
}
