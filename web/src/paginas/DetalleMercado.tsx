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
  const esVendedor = venta?.vendedor === wallet.direccion;
  const integro = resultado.analisis.length > 0 && resultado.analisis.every((a) => a.vigente.verificacion.estado === 'integro');

  const comprar = async () => {
    if (await compra.ejecutar('buy', lote.id)) setRecarga((n) => n + 1);
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
              disabled={compra.ocupado || !wallet.direccion || !wallet.redCorrecta}
            >
              {compra.ocupado ? 'Procesando…' : `Comprar por ${formatoPrecio(venta.precio, info.token)}`}
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
