import { Link } from 'react-router';
import { formatoFechaHora, acortar } from '../formato.ts';
import {
  ETIQUETA_ESTADO,
  formatoPrecio,
  formatoPureza,
  type EstadoComercial,
  type EstadoLote,
  type EventoCronologia,
  type InfoToken,
  type PasoTransaccion,
  type ResultadoTransaccion,
  venceGarantia,
} from '../mercado.ts';
import { useWallet } from '../wallet.tsx';

export function PillEstadoLote({ estado }: { estado: EstadoLote }) {
  const e = ETIQUETA_ESTADO[estado];
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${e.clases}`}>{e.texto}</span>;
}

/** Dirección Stellar abreviada; marca "(usted)" si es la wallet conectada. */
export function Cuenta({ direccion }: { direccion: string | null | undefined }) {
  const { direccion: propia } = useWallet();
  if (!direccion) return <span className="text-stone-400">—</span>;
  return (
    <span className="font-mono text-xs" title={direccion}>
      {acortar(direccion, 5)}
      {direccion === propia && <span className="ml-1 font-sans font-semibold text-mineral-700">(usted)</span>}
    </span>
  );
}

/** Botón de la barra superior: conectar Freighter, ver la cuenta o avisar de red equivocada. */
export function BotonWallet() {
  const wallet = useWallet();
  if (wallet.instalada === false && !wallet.direccion) {
    return (
      <a
        href="https://www.freighter.app/"
        target="_blank"
        rel="noreferrer"
        className="rounded-lg px-3 py-2 text-sm text-stone-300 hover:text-white"
        title="Instale la extensión Freighter para comprar y vender lotes"
      >
        Instalar Freighter
      </a>
    );
  }
  if (!wallet.direccion) {
    return (
      <button
        onClick={() => void wallet.conectar()}
        disabled={wallet.conectando}
        className="rounded-lg bg-mineral-500 px-3 py-1.5 text-sm font-semibold text-stone-900 hover:bg-mineral-400 disabled:opacity-60"
        title={wallet.error ?? undefined}
      >
        {wallet.conectando ? 'Conectando…' : 'Conectar wallet'}
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Link
        to="/mis-lotes"
        className={`rounded-lg px-3 py-1.5 font-mono text-xs ${wallet.redCorrecta ? 'bg-stone-800 text-stone-100' : 'bg-red-600 text-white'}`}
        title={wallet.redCorrecta ? wallet.direccion : `Freighter está en ${wallet.red}: cambie a Testnet`}
      >
        {wallet.redCorrecta ? acortar(wallet.direccion, 4) : 'Red incorrecta'}
      </Link>
      <button onClick={wallet.desconectar} className="rounded px-1.5 text-stone-400 hover:text-white" title="Desconectar wallet" aria-label="Desconectar wallet">
        ×
      </button>
    </span>
  );
}

/** Aviso cuando hace falta la wallet para operar. */
export function AvisoWallet() {
  const wallet = useWallet();
  if (wallet.direccion && wallet.redCorrecta) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-mineral-50 p-3 text-sm text-stone-700">
      <p>
        {wallet.direccion
          ? `Freighter está en ${wallet.red ?? 'otra red'}. Cambie a Testnet en la extensión para operar.`
          : wallet.instalada === false
            ? 'Para comprar o vender necesita la extensión Freighter (red Testnet).'
            : 'Conecte su wallet Freighter (red Testnet) para comprar o vender.'}
      </p>
      {!wallet.direccion && wallet.instalada !== false && (
        <button className="boton-primario" onClick={() => void wallet.conectar()} disabled={wallet.conectando}>
          {wallet.conectando ? 'Conectando…' : 'Conectar wallet'}
        </button>
      )}
      {wallet.instalada === false && (
        <a className="boton-primario" href="https://www.freighter.app/" target="_blank" rel="noreferrer">
          Instalar Freighter
        </a>
      )}
      {wallet.error && <p className="w-full text-xs font-medium text-red-700">{wallet.error}</p>}
    </div>
  );
}

const TEXTO_PASO: Partial<Record<PasoTransaccion, string>> = {
  preparando: 'Preparando la transacción…',
  firmando: 'Revise y firme la transacción en Freighter…',
  enviando: 'Enviando a Stellar y esperando la confirmación (unos segundos)…',
};

export function EstadoTransaccion({
  paso,
  error,
  resultado,
}: {
  paso: PasoTransaccion;
  error: string | null;
  resultado: ResultadoTransaccion | null;
}) {
  if (paso === 'inactivo') return null;
  if (paso === 'error') {
    return (
      <p className="rounded-lg bg-red-50 p-3 text-sm font-medium text-red-700" role="alert">
        {error}
      </p>
    );
  }
  if (paso === 'confirmada' && resultado) {
    return (
      <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800" role="status">
        ✓ Transacción confirmada.{' '}
        <a href={resultado.url_explorador} target="_blank" rel="noreferrer" className="font-medium underline">
          Ver en el explorador ↗
        </a>
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 rounded-lg bg-stone-100 p-3 text-sm text-stone-700" role="status">
      <span className="h-2 w-2 animate-pulse rounded-full bg-mineral-500" />
      {TEXTO_PASO[paso]}
    </p>
  );
}

/** Estado comercial del lote leído del contrato. */
export function ResumenComercial({ estado, token, toleranciaBps }: { estado: EstadoComercial; token: InfoToken; toleranciaBps: number }) {
  const { venta, contra_analisis: contra } = estado;
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-stone-500">Estado comercial</dt>
        <dd className="mt-0.5">
          <PillEstadoLote estado={estado.estado} />
        </dd>
      </div>
      <div>
        <dt className="text-stone-500">Dueño</dt>
        <dd>
          <Cuenta direccion={estado.dueno} />
        </dd>
      </div>
      <div>
        <dt className="text-stone-500">Pureza certificada</dt>
        <dd className="font-mono">
          {formatoPureza(venta?.pureza_bps ?? estado.pureza_bps)}% · {venta?.analisis_id ?? estado.analisis_id} v{venta?.version ?? estado.version}
        </dd>
      </div>
      {venta && (
        <>
          <div>
            <dt className="text-stone-500">Precio</dt>
            <dd className="font-semibold">{formatoPrecio(venta.precio, token)}</dd>
          </div>
          <div>
            <dt className="text-stone-500">Vendedor</dt>
            <dd>
              <Cuenta direccion={venta.vendedor} />
            </dd>
          </div>
          <div>
            <dt className="text-stone-500">Comprador</dt>
            <dd>
              <Cuenta direccion={venta.comprador} />
            </dd>
          </div>
          {venceGarantia(venta) && estado.estado === 'EnGarantia' && (
            <div>
              <dt className="text-stone-500">Garantía vence</dt>
              <dd title="Si para entonces el comprador no confirmó ni hay disputa, el vendedor puede cobrar">
                {formatoFechaHora(venceGarantia(venta))}
              </dd>
            </div>
          )}
        </>
      )}
      {contra && (
        <div className="sm:col-span-2">
          <dt className="text-stone-500">Contra-análisis</dt>
          <dd>
            {formatoPureza(contra.pureza_bps)}% · diferencia {formatoPureza(contra.diferencia_bps)} puntos (tolerancia{' '}
            {formatoPureza(toleranciaBps)}) ·{' '}
            {contra.diferencia_bps > toleranciaBps ? (
              <span className="font-semibold text-red-700">fuera de tolerancia</span>
            ) : (
              <span className="font-semibold text-emerald-700">dentro de tolerancia</span>
            )}
          </dd>
        </div>
      )}
      {estado.estado === 'EnDisputa' && !venta && (
        <p className="text-xs text-stone-600 sm:col-span-2">
          El comprador recuperó su dinero. El lote no puede volver a venderse hasta que el laboratorio que lo certificó
          registre un análisis nuevo.
        </p>
      )}
    </dl>
  );
}

function describirEvento(e: EventoCronologia, token: InfoToken | null): { titulo: string; detalle?: string } {
  const d = e.datos as Record<string, string | number | boolean>;
  const precio = (valor: unknown) => (token && valor !== undefined ? formatoPrecio(String(valor), token) : '');
  switch (e.tipo) {
    case 'analisis_registrado':
      return {
        titulo: Number(d.version) > 1 ? `Corrección registrada (${d.analisis_id} v${d.version})` : `Certificado (${d.analisis_id})`,
        detalle: `Pureza ${formatoPureza(Number(d.pureza_bps))}%`,
      };
    case 'lote_publicado':
      return { titulo: 'Publicado en el mercado', detalle: `${precio(d.precio)} · pureza ${formatoPureza(Number(d.pureza_bps))}%` };
    case 'lote_comprado':
      return { titulo: 'Comprado: pago en garantía', detalle: `${precio(d.precio)} retenidos por el contrato` };
    case 'contra_analisis_registrado':
      return {
        titulo: d.en_disputa ? 'Contra-análisis fuera de tolerancia: en disputa' : 'Contra-análisis dentro de tolerancia',
        detalle: `Pureza ${formatoPureza(Number(d.pureza_bps))}% · diferencia ${formatoPureza(Number(d.diferencia_bps))} puntos`,
      };
    case 'venta_confirmada':
      return { titulo: 'Vendido: pago liberado al vendedor', detalle: `${precio(d.precio)} · el lote cambió de dueño` };
    case 'reembolsado':
      return { titulo: 'Reembolsado al comprador', detalle: precio(d.precio) };
    case 'pago_reclamado':
      return { titulo: 'Plazo de garantía vencido: el vendedor cobró', detalle: `${precio(d.precio)} · el lote cambió de dueño` };
    default:
      return { titulo: e.tipo };
  }
}

/** Línea de tiempo del lote a partir de los eventos del contrato. */
export function Cronologia({ eventos, token }: { eventos: EventoCronologia[]; token: InfoToken | null }) {
  if (eventos.length === 0) {
    return <p className="text-sm text-stone-500">Aún no hay eventos del contrato para este lote.</p>;
  }
  return (
    <ol className="space-y-3">
      {eventos.map((e) => {
        const { titulo, detalle } = describirEvento(e, token);
        const alerta = e.tipo === 'reembolsado' || (e.tipo === 'contra_analisis_registrado' && e.datos.en_disputa);
        return (
          <li key={`${e.tx_hash}-${e.tipo}`} className={`border-l-2 pl-4 text-sm ${alerta ? 'border-red-400' : 'border-mineral-400'}`}>
            <p className="font-semibold">{titulo}</p>
            {detalle && <p className="text-stone-600">{detalle}</p>}
            <p className="text-xs text-stone-500">
              {formatoFechaHora(e.fecha)} ·{' '}
              <a href={e.url_explorador} target="_blank" rel="noreferrer" className="text-mineral-700 hover:underline">
                transacción ↗
              </a>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
