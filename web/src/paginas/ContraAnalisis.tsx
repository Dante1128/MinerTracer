import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ErrorApi } from '../api.ts';
import { CamposAnalisis, MensajeError, aFormData, datosIniciales } from '../componentes/CamposAnalisis.tsx';
import { AvisoCuentaLaboratorio, useCuentaLaboratorio } from '../componentes/FirmaLaboratorio.tsx';
import { Cuenta, EstadoTransaccion } from '../componentes/Mercado.tsx';
import { useInfoServidor } from '../infoServidor.ts';
import {
  formatoPureza,
  useFirmaConWallet,
  useInfoMercado,
  type DetalleComercial,
  type EstadoComercial,
  type ResultadoTransaccion,
} from '../mercado.ts';
import { useSesion } from '../sesion.tsx';
import { useWallet } from '../wallet.tsx';

interface Registrado {
  lote_id: string;
  tx_id: string;
}

/** Portal del laboratorio: contra-análisis de un lote en garantía certificado por otro laboratorio. */
export function ContraAnalisis() {
  const { usuario } = useSesion();
  const info = useInfoMercado();
  const firmaWallet = useInfoServidor()?.firma_laboratorio === 'wallet';
  const cuentaLab = useCuentaLaboratorio();
  const wallet = useWallet();
  const firma = useFirmaConWallet();
  const [pendientes, setPendientes] = useState<EstadoComercial[] | null>(null);
  const [loteId, setLoteId] = useState('');
  const [datos, setDatos] = useState(datosIniciales);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [registrado, setRegistrado] = useState<{ registro: Registrado; detalle: DetalleComercial | null } | null>(null);

  useEffect(() => {
    if (!info?.habilitado) return;
    api<EstadoComercial[]>('/contra-analisis/pendientes')
      .then(setPendientes)
      .catch((e) => setMensaje(e instanceof ErrorApi ? e.message : 'No se pudo leer el contrato'));
  }, [info, registrado]);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErrores({});
    setMensaje(null);
    try {
      const form = aFormData(datos);
      form.set('lote_id', loteId);
      let registro: Registrado;
      if (firmaWallet) {
        // Preparar (el servidor sella el registro) → firmar con Freighter → enviar.
        let enviado: Registrado | null = null;
        const r = await firma.ejecutar(
          async (cuenta) => {
            form.set('cuenta', cuenta);
            try {
              return await api<{ xdr: string; registro: unknown; pdf_nombre: string }>('/contra-analisis/preparar', { form });
            } catch (err) {
              if (err instanceof ErrorApi) setErrores(err.errores);
              throw err;
            }
          },
          async (xdr, _cuenta, preparado) => {
            enviado = await api<Registrado>('/contra-analisis/enviar', {
              json: { registro: preparado.registro, pdf_nombre: preparado.pdf_nombre, xdr },
            });
            return { tx_id: enviado.tx_id, url_explorador: `https://stellar.expert/explorer/testnet/tx/${enviado.tx_id}`, fecha: '' } satisfies ResultadoTransaccion;
          },
        );
        if (!r || !enviado) return;
        registro = enviado;
      } else {
        registro = await api<Registrado>('/contra-analisis', { form });
      }
      const detalle = await api<DetalleComercial>(`/mercado/lotes/${encodeURIComponent(registro.lote_id)}`).catch(() => null);
      setRegistrado({ registro, detalle });
      setDatos(datosIniciales());
      setLoteId('');
    } catch (err) {
      if (err instanceof ErrorApi) {
        setErrores(err.errores);
        setMensaje(err.message);
      } else {
        setMensaje('Error inesperado');
      }
    } finally {
      setEnviando(false);
    }
  };

  const elegido = pendientes?.find((p) => p.lote_id === loteId);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <div>
        <Link to="/laboratorio" className="text-sm text-stone-500 hover:text-stone-800">
          ← Volver al panel
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Contra-análisis</h1>
        <p className="mt-1 text-stone-600">
          Mida de nuevo un lote vendido que está en garantía. Si su pureza difiere de la certificada más que la tolerancia
          {info?.habilitado && ` (${formatoPureza(info.tolerancia_bps)} puntos)`}, el lote pasa a disputa y el comprador puede
          recuperar su dinero. Solo puede hacerlo un laboratorio distinto del que certificó el lote.
        </p>
        <p className="mt-1 text-sm text-stone-500">
          {usuario?.laboratorio_id} ·{' '}
          {firmaWallet ? 'se firma con la wallet del laboratorio (Freighter).' : 'firma el servidor con la cuenta del laboratorio.'}
        </p>
      </div>

      {registrado && (
        <div className="rounded-2xl bg-emerald-50 p-5 text-sm text-emerald-900" role="status">
          <p className="font-semibold">✓ Contra-análisis registrado en el contrato para {registrado.registro.lote_id}.</p>
          {registrado.detalle?.estado?.contra_analisis && (
            <p className="mt-1">
              Diferencia: {formatoPureza(registrado.detalle.estado.contra_analisis.diferencia_bps)} puntos ·{' '}
              {registrado.detalle.estado.estado === 'EnDisputa' ? (
                <strong className="text-red-700">el lote pasó a disputa</strong>
              ) : (
                <strong>dentro de tolerancia: el comprador puede confirmar</strong>
              )}
            </p>
          )}
          <p className="mt-2 flex gap-4">
            <a href={`https://stellar.expert/explorer/testnet/tx/${registrado.registro.tx_id}`} target="_blank" rel="noreferrer" className="underline">
              Ver la transacción ↗
            </a>
            <Link to={`/verificar/${registrado.registro.lote_id}`} className="underline">
              Vista pública del lote
            </Link>
          </p>
        </div>
      )}

      {info && !info.habilitado ? (
        <p className="tarjeta p-6 text-stone-600">El contra-análisis necesita el anclaje en Stellar (ANCLAJE=stellar).</p>
      ) : pendientes === null ? (
        <p className="text-stone-500">{mensaje ?? 'Buscando lotes en garantía en el contrato…'}</p>
      ) : pendientes.length === 0 ? (
        <p className="tarjeta p-6 text-stone-600">
          No hay lotes en garantía pendientes de contra-análisis certificados por otros laboratorios.
        </p>
      ) : (
        <form onSubmit={enviar} className="space-y-6">
          <section className="tarjeta space-y-3 p-6">
            <h2 className="font-semibold">1. Lote en garantía</h2>
            <select className="campo" value={loteId} onChange={(e) => setLoteId(e.target.value)} required>
              <option value="">Seleccione…</option>
              {pendientes.map((p) => (
                <option key={p.lote_id} value={p.lote_id}>
                  {p.lote_id} — {p.tipo_mineral ?? 'lote'} · certificado {formatoPureza(p.venta?.pureza_bps ?? p.pureza_bps)}%
                  {p.laboratorio ? ` por ${p.laboratorio.nombre}` : ''}
                </option>
              ))}
            </select>
            {elegido?.venta && (
              <p className="text-sm text-stone-600">
                Vendido por <Cuenta direccion={elegido.venta.vendedor} /> a <Cuenta direccion={elegido.venta.comprador} />. Pureza
                certificada: <span className="font-mono">{formatoPureza(elegido.venta.pureza_bps)}%</span>.
              </p>
            )}
            <MensajeError texto={errores.lote_id} />
          </section>

          <section className="tarjeta p-6">
            <h2 className="mb-4 font-semibold">2. Resultados del contra-análisis</h2>
            <CamposAnalisis datos={datos} cambiar={setDatos} errores={errores} pdfObligatorio />
          </section>

          {firmaWallet && <AvisoCuentaLaboratorio cuenta={cuentaLab} />}
          {mensaje && <p className="rounded-lg bg-red-50 p-3 text-sm font-medium text-red-700">{mensaje}</p>}
          {firmaWallet && <EstadoTransaccion paso={firma.paso} error={firma.error} resultado={firma.resultado} />}
          <div className="flex justify-end">
            <button
              className="boton-primario"
              disabled={
                enviando || !loteId || (firmaWallet && (!wallet.direccion || !wallet.redCorrecta || wallet.direccion !== cuentaLab))
              }
            >
              {enviando ? 'Registrando en el contrato…' : firmaWallet ? 'Firmar con Freighter y registrar' : 'Registrar contra-análisis'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
