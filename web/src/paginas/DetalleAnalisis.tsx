import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import { api, ErrorApi, type AnalisisVerificado, type Lote } from '../api.ts';
import { CamposAnalisis, MensajeError, aFormData, datosIniciales } from '../componentes/CamposAnalisis.tsx';
import { esperaFirma, FirmaAnalisis } from '../componentes/FirmaLaboratorio.tsx';
import { EstadoAnclaje, PillVerificacion } from '../componentes/Insignias.tsx';
import { BannerVerificacion, DatosAnalisis, Evidencia } from '../componentes/Verificacion.tsx';
import { formatoFechaHora, formatoPeso } from '../formato.ts';
import { useInfoServidor } from '../infoServidor.ts';
import { useSesion } from '../sesion.tsx';

interface Detalle {
  lote: Lote & { laboratorio_id: string };
  versiones: AnalisisVerificado[];
}

export function DetalleAnalisis() {
  const { analisisId = '' } = useParams();
  const { usuario } = useSesion();
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const info = useInfoServidor();
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const recargar = useCallback(() => setRecarga((n) => n + 1), []);
  const firmaWallet = info?.firma_laboratorio === 'wallet';

  useEffect(() => {
    let vigente = true;
    let temporizador: ReturnType<typeof setTimeout>;
    const cargar = async () => {
      try {
        const d = await api<Detalle>(`/analisis/${encodeURIComponent(analisisId)}`);
        if (!vigente) return;
        setDetalle(d);
        // Se vuelve a consultar mientras haya anclajes en curso (no los que esperan la firma del laboratorio).
        const enCurso = d.versiones.some((v) => v.estado_anclaje === 'pendiente' && !esperaFirma(v, firmaWallet));
        if (enCurso) temporizador = setTimeout(cargar, 2000);
      } catch (e) {
        if (vigente) setError(e instanceof ErrorApi ? e.message : 'Error inesperado');
      }
    };
    void cargar();
    return () => {
      vigente = false;
      clearTimeout(temporizador);
    };
  }, [analisisId, recarga, firmaWallet]);

  if (error) return <p className="py-16 text-center text-red-600">{error}</p>;
  if (!detalle) return <p className="py-16 text-center text-stone-500">Cargando…</p>;

  const { lote, versiones } = detalle;
  const vigente = versiones[versiones.length - 1];
  const urlVerificacion = `${window.location.origin}/verificar/${lote.id}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="print:hidden">
        <Link to="/laboratorio" className="text-sm text-stone-500 hover:text-stone-800">
          ← Volver al panel
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-3xl font-bold">{vigente.analisis_id}</h1>
          <span className="rounded bg-stone-200 px-2 py-0.5 font-mono text-xs">v{vigente.version}</span>
          <EstadoAnclaje analisis={vigente} esperaFirma={esperaFirma(vigente, firmaWallet)} />
        </div>
        <p className="mt-1 text-stone-600">
          Lote <span className="font-mono">{lote.id}</span> · {lote.tipo_mineral} · {formatoPeso(lote.peso_kg)} · {lote.origen}
        </p>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6 print:hidden">
          {versiones
            .filter((v) => esperaFirma(v, firmaWallet))
            .map((v) => (
              <FirmaAnalisis key={v.version} analisis={v} alTerminar={recargar} />
            ))}
          <BannerVerificacion analisis={vigente} laboratorio={lote.laboratorio_id} />
          <section className="tarjeta p-6">
            <DatosAnalisis analisis={vigente} />
          </section>
          <section className="tarjeta p-6">
            <h2 className="mb-4 font-semibold">Evidencia de integridad</h2>
            <Evidencia analisis={vigente} />
          </section>

          {corrigiendo && (
            <FormularioCorreccion
              base={vigente}
              alTerminar={() => {
                setCorrigiendo(false);
                recargar();
              }}
            />
          )}

          {versiones.length > 1 && (
            <section className="tarjeta p-6">
              <h2 className="font-semibold">Historial de versiones</h2>
              <ol className="mt-4 space-y-3">
                {[...versiones].reverse().map((v) => (
                  <li key={v.version} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-l-2 border-stone-200 pl-4 text-sm">
                    <span className="font-mono font-semibold">v{v.version}</span>
                    <span className="font-mono">{v.pureza}%</span>
                    <PillVerificacion estado={v.verificacion.estado} />
                    <span className="text-stone-500">
                      {v.analista_nombre} · {formatoFechaHora(v.creado_en)}
                    </span>
                    {v.motivo_correccion && <span className="w-full text-stone-600">Motivo: {v.motivo_correccion}</span>}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <div className="tarjeta p-5 text-center print:border-2 print:border-stone-900 print:shadow-none">
            <p className="text-sm font-semibold">Código de verificación del lote</p>
            <div className="mx-auto mt-3 w-fit rounded-lg bg-white p-2">
              <QRCodeSVG value={urlVerificacion} size={200} level="M" marginSize={2} />
            </div>
            <p className="mt-2 font-mono text-lg font-bold">{lote.id}</p>
            <p className="text-xs break-all text-stone-500">{urlVerificacion}</p>
            <div className="mt-4 flex gap-2 print:hidden">
              <button className="boton-secundario flex-1" onClick={() => window.print()}>
                Imprimir
              </button>
              <Link to={`/verificar/${lote.id}`} className="boton-secundario flex-1">
                Vista pública
              </Link>
            </div>
          </div>

          {usuario?.rol === 'supervisor' && !corrigiendo && (
            <div className="tarjeta p-5 print:hidden">
              <p className="text-sm font-semibold">¿Hay un error en el análisis?</p>
              <p className="mt-1 text-xs text-stone-600">
                La versión actual no se modifica: se registra una nueva versión enlazada, con su propio anclaje.
              </p>
              <button className="boton-secundario mt-3 w-full" onClick={() => setCorrigiendo(true)}>
                Registrar corrección
              </button>
            </div>
          )}

          {info?.demo_alterar && vigente.estado_anclaje === 'anclado' && (
            <SimularFraude analisisId={vigente.analisis_id} pureza={vigente.pureza} alTerminar={recargar} />
          )}
        </aside>
      </div>
    </div>
  );
}

function FormularioCorreccion({ base, alTerminar }: { base: AnalisisVerificado; alTerminar: () => void }) {
  const [datos, setDatos] = useState(() => datosIniciales(base));
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErrores({});
    setMensaje(null);
    try {
      const form = aFormData(datos);
      form.set('motivo_correccion', motivo);
      await api(`/analisis/${encodeURIComponent(base.analisis_id)}/versiones`, { form });
      alTerminar();
    } catch (err) {
      if (err instanceof ErrorApi) {
        setErrores(err.errores);
        setMensaje(err.message);
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="tarjeta space-y-4 border-mineral-400 p-6">
      <div>
        <h2 className="font-semibold">Corrección: versión {base.version + 1}</h2>
        <p className="text-sm text-stone-600">La versión {base.version} seguirá visible en el historial.</p>
      </div>
      <div>
        <label className="etiqueta" htmlFor="motivo">
          Motivo de la corrección
        </label>
        <input id="motivo" className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} required />
        <MensajeError texto={errores.motivo_correccion} />
      </div>
      <CamposAnalisis datos={datos} cambiar={setDatos} errores={errores} pdfObligatorio={false} />
      {mensaje && <p className="text-sm font-medium text-red-600">{mensaje}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="boton-secundario" onClick={alTerminar}>
          Cancelar
        </button>
        <button className="boton-primario" disabled={enviando}>
          {enviando ? 'Registrando…' : 'Registrar versión'}
        </button>
      </div>
    </form>
  );
}

/** Solo en desarrollo (DEMO_ALTERAR=true): simula al intermediario de la sección 13. */
function SimularFraude({ analisisId, pureza, alTerminar }: { analisisId: string; pureza: string; alTerminar: () => void }) {
  const [nuevaPureza, setNuevaPureza] = useState('95.00');
  const [falsificarPdf, setFalsificarPdf] = useState(true);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const alterar = async () => {
    try {
      await api('/demo/alterar', { json: { analisis_id: analisisId, pureza: nuevaPureza, falsificar_pdf: falsificarPdf } });
      setMensaje(null);
      alTerminar();
    } catch (err) {
      setMensaje(err instanceof ErrorApi ? err.message : 'Error');
    }
  };

  return (
    <div className="rounded-2xl border-2 border-dashed border-red-300 bg-red-50 p-5 print:hidden">
      <p className="text-sm font-semibold text-red-800">Demostración: simular fraude</p>
      <p className="mt-1 text-xs text-red-900/80">
        Actúa como un intermediario con acceso directo a la base de datos: desactiva la protección, cambia la pureza
        ({pureza}%), recalcula el hash local y reemplaza el PDF. Solo disponible en desarrollo.
      </p>
      <div className="mt-3 flex gap-2">
        <input className="campo font-mono" value={nuevaPureza} onChange={(e) => setNuevaPureza(e.target.value)} aria-label="Pureza falsa" />
        <button className="boton shrink-0 bg-red-600 text-white hover:bg-red-700" onClick={alterar}>
          Alterar
        </button>
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-red-900">
        <input type="checkbox" checked={falsificarPdf} onChange={(e) => setFalsificarPdf(e.target.checked)} />
        También reemplazar el PDF
      </label>
      {mensaje && <p className="mt-2 text-xs font-medium text-red-700">{mensaje}</p>}
    </div>
  );
}
