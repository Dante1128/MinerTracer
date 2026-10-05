import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, ErrorApi } from '../api.ts';
import { AvisoWallet, Cuenta, EstadoTransaccion, PillEstadoLote } from '../componentes/Mercado.tsx';
import { formatoFechaHora } from '../formato.ts';
import {
  formatoPlazo,
  formatoPrecio,
  formatoPureza,
  garantiaVencida,
  useInfoMercado,
  useTransaccion,
  venceGarantia,
  type EstadoComercial,
  type InfoToken,
} from '../mercado.ts';
import { useWallet } from '../wallet.tsx';

export function MisLotes() {
  const wallet = useWallet();
  const info = useInfoMercado();
  const [lotes, setLotes] = useState<EstadoComercial[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const cuenta = wallet.direccion;

  useEffect(() => {
    if (!cuenta || !info?.habilitado) return;
    let vigente = true;
    setError(null);
    api<EstadoComercial[]>(`/mercado/cuentas/${cuenta}/lotes`)
      .then((l) => vigente && setLotes(l))
      .catch((e) => vigente && setError(e instanceof ErrorApi ? e.message : 'No se pudo leer el contrato'));
    return () => {
      vigente = false;
    };
  }, [cuenta, info, recarga]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Mis lotes</h1>
        <p className="mt-2 text-stone-600">
          Lotes de los que su wallet es dueña, vendedora o compradora, según el contrato.
          {cuenta && (
            <>
              {' '}
              Cuenta: <Cuenta direccion={cuenta} />
            </>
          )}
        </p>
      </div>
      <AvisoWallet />

      {info && !info.habilitado ? (
        <p className="tarjeta p-6 text-stone-600">El mercado necesita el anclaje en Stellar (ANCLAJE=stellar).</p>
      ) : !cuenta ? null : error ? (
        <p className="tarjeta p-6 text-red-700">{error}</p>
      ) : lotes === null || !info ? (
        <p className="text-stone-500">Leyendo sus lotes en el contrato…</p>
      ) : lotes.length === 0 ? (
        <p className="tarjeta p-6 text-stone-600">
          Esta cuenta no tiene lotes. Un laboratorio registra el lote con su dirección como dueña, o puede comprar uno en el{' '}
          <Link to="/mercado" className="font-medium text-mineral-700 hover:underline">
            mercado
          </Link>
          .
        </p>
      ) : (
        <div className="space-y-4">
          {lotes.map((l) => (
            <TarjetaLote
              key={l.lote_id}
              lote={l}
              cuenta={cuenta}
              token={info.token}
              toleranciaBps={info.tolerancia_bps}
              plazoSeg={info.plazo_garantia_seg}
              alCambiar={() => setRecarga((n) => n + 1)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TarjetaLote({
  lote,
  cuenta,
  token,
  toleranciaBps,
  plazoSeg,
  alCambiar,
}: {
  lote: EstadoComercial;
  cuenta: string;
  token: InfoToken;
  toleranciaBps: number;
  plazoSeg: number;
  alCambiar: () => void;
}) {
  const tx = useTransaccion();
  const [precio, setPrecio] = useState('');
  const { estado, venta, contra_analisis: contra } = lote;
  const esDueno = lote.dueno === cuenta;
  const esComprador = venta?.comprador === cuenta;
  const esVendedor = venta?.vendedor === cuenta;

  const vence = venceGarantia(venta);
  const ejecutar = async (accion: 'list_batch' | 'confirm' | 'refund' | 'claim') => {
    if (await tx.ejecutar(accion, lote.lote_id, accion === 'list_batch' ? precio : undefined)) alCambiar();
  };

  let papel = 'Dueño';
  if (esComprador) papel = 'Comprador';
  else if (esVendedor) papel = 'Vendedor';

  return (
    <article className="tarjeta space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Link to={`/mercado/${lote.lote_id}`} className="font-mono text-lg font-semibold hover:underline">
            {lote.lote_id}
          </Link>
          <PillEstadoLote estado={estado} />
          <span className="text-xs font-semibold tracking-wide text-stone-500 uppercase">{papel}</span>
        </div>
        <Link to={`/verificar/${lote.lote_id}`} className="text-sm text-mineral-700 hover:underline">
          Verificación ↗
        </Link>
      </div>
      <p className="text-sm text-stone-600">
        {lote.tipo_mineral ?? 'Lote'} · pureza certificada <span className="font-mono">{formatoPureza(venta?.pureza_bps ?? lote.pureza_bps)}%</span>
        {lote.laboratorio && ` · ${lote.laboratorio.nombre}`}
        {venta && ` · ${formatoPrecio(venta.precio, token)}`}
      </p>

      {/* Dueño: publicar (también tras una compra, para revender). */}
      {esDueno && (estado === 'Certificado' || estado === 'Vendido') && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void ejecutar('list_batch');
          }}
        >
          <div>
            <label className="etiqueta" htmlFor={`precio-${lote.lote_id}`}>
              Precio ({token.simbolo})
            </label>
            <input
              id={`precio-${lote.lote_id}`}
              className="campo w-40 font-mono"
              inputMode="decimal"
              placeholder="100"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              required
            />
          </div>
          <button className="boton-primario" disabled={tx.ocupado || !precio.trim()}>
            {tx.ocupado ? 'Procesando…' : 'Publicar en el mercado'}
          </button>
        </form>
      )}

      {esVendedor && estado === 'EnVenta' && <p className="text-sm text-stone-600">Publicado: esperando comprador.</p>}
      {esVendedor && estado === 'EnGarantia' && (
        <div className="space-y-2">
          <p className="text-sm text-stone-600">
            Comprado por <Cuenta direccion={venta?.comprador} />. El pago está en garantía: lo recibirá cuando el comprador
            confirme la recepción
            {vence && <> o, si no confirma ni hay disputa, a partir del {formatoFechaHora(vence)}</>}.
          </p>
          {garantiaVencida(venta) && (
            <button className="boton-primario" onClick={() => void ejecutar('claim')} disabled={tx.ocupado}>
              {tx.ocupado ? 'Procesando…' : `Cobrar: venció el plazo de garantía (${formatoPrecio(venta!.precio, token)})`}
            </button>
          )}
        </div>
      )}
      {esVendedor && estado === 'EnDisputa' && venta && (
        <p className="text-sm text-red-700">
          Un contra-análisis difiere más que la tolerancia: el comprador puede pedir el reembolso.
        </p>
      )}
      {esDueno && estado === 'EnDisputa' && !venta && (
        <p className="text-sm text-stone-600">
          Venta reembolsada. El lote no puede publicarse hasta que el laboratorio que lo certificó registre un análisis nuevo.
        </p>
      )}

      {/* Comprador: confirmar o pedir el reembolso. */}
      {esComprador && estado === 'EnGarantia' && (
        <div className="space-y-2">
          <p className="text-sm text-stone-600">
            Su pago está en garantía.{' '}
            {contra
              ? `El contra-análisis (${formatoPureza(contra.pureza_bps)}%) quedó dentro de la tolerancia de ${formatoPureza(toleranciaBps)} puntos.`
              : 'Puede pedir un contra-análisis a otro laboratorio antes de confirmar.'}{' '}
            Al confirmar, el vendedor cobra y el lote pasa a su nombre.
            {vence && (
              <>
                {' '}
                Tiene {formatoPlazo(plazoSeg)} desde la compra, hasta el <strong>{formatoFechaHora(vence)}</strong>: después, si no hay
                disputa, el vendedor puede cobrar sin su confirmación.
              </>
            )}
          </p>
          <button className="boton-primario" onClick={() => void ejecutar('confirm')} disabled={tx.ocupado}>
            {tx.ocupado ? 'Procesando…' : 'Confirmar recepción y liberar el pago'}
          </button>
        </div>
      )}
      {esComprador && estado === 'EnDisputa' && venta && (
        <div className="space-y-2">
          <p className="text-sm text-red-700">
            El contra-análisis dio {contra ? `${formatoPureza(contra.pureza_bps)}%` : 'otra pureza'}: diferencia mayor que la
            tolerancia. Puede recuperar su pago.
          </p>
          <button className="boton bg-red-600 text-white hover:bg-red-700" onClick={() => void ejecutar('refund')} disabled={tx.ocupado}>
            {tx.ocupado ? 'Procesando…' : `Pedir reembolso (${formatoPrecio(venta.precio, token)})`}
          </button>
        </div>
      )}

      <EstadoTransaccion paso={tx.paso} error={tx.error} resultado={tx.resultado} />
    </article>
  );
}
