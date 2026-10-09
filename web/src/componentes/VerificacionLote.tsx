import { useEffect, useState, type ReactNode } from 'react';
import { api, ErrorApi, type ResultadoLote } from '../api.ts';
import { formatoFechaHora } from '../formato.ts';
import { useInfoMercado, type DetalleComercial } from '../mercado.ts';
import { Composicion, Hash, PillVerificacion } from './Insignias.tsx';
import { Cronologia, ResumenComercial } from './Mercado.tsx';
import { BannerVerificacion, DatosAnalisis, Evidencia } from './Verificacion.tsx';

/** Verificación pública de un lote: se vuelve a consultar mientras haya anclajes en curso. */
export function useVerificacionLote(loteId: string) {
  const [resultado, setResultado] = useState<ResultadoLote | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    let temporizador: ReturnType<typeof setTimeout>;
    const cargar = async () => {
      try {
        const r = await api<ResultadoLote>(`/publico/lotes/${encodeURIComponent(loteId)}`);
        if (!vigente) return;
        setResultado(r);
        setError(null);
        if (r.analisis.some((g) => g.vigente.verificacion.estado === 'pendiente')) temporizador = setTimeout(cargar, 3000);
      } catch (e) {
        if (vigente) setError(e instanceof ErrorApi ? e.message : 'Error inesperado');
      }
    };
    setResultado(null);
    void cargar();
    return () => {
      vigente = false;
      clearTimeout(temporizador);
    };
  }, [loteId]);

  return { resultado, error };
}

/** Cada análisis del lote con su veredicto, datos, evidencia e historial de versiones. */
export function AnalisisDelLote({ resultado }: { resultado: ResultadoLote }) {
  const { laboratorio } = resultado;
  if (resultado.analisis.length === 0) {
    return <p className="tarjeta p-6 text-stone-600">Este lote todavía no tiene análisis registrados.</p>;
  }
  return (
    <>
      {resultado.analisis.map(({ analisis_id, vigente, versiones }) => (
        <article key={analisis_id} className="space-y-4">
          <BannerVerificacion analisis={vigente} laboratorio={laboratorio.id} />
          <section className="tarjeta p-6">
            <DatosAnalisis analisis={vigente} />
          </section>
          <section className="tarjeta p-6">
            <h2 className="mb-4 font-semibold">Evidencia de integridad</h2>
            <Evidencia analisis={vigente} />
          </section>

          {versiones.length > 1 && (
            <section className="tarjeta p-6">
              <h2 className="font-semibold">Historial de versiones</h2>
              <p className="mt-1 text-sm text-stone-500">
                Las correcciones no sobrescriben el análisis: cada versión queda registrada y enlazada a la anterior.
              </p>
              <ol className="mt-4 space-y-3">
                {[...versiones].reverse().map((v) => (
                  <li key={v.version} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-l-2 border-stone-200 pl-4 text-sm">
                    <span className="font-mono font-semibold">v{v.version}</span>
                    <span className="font-mono">{v.pureza}%</span>
                    <PillVerificacion estado={v.verificacion.estado} />
                    <span className="text-stone-500">{formatoFechaHora(v.creado_en)}</span>
                    {v.motivo_correccion && <span className="w-full text-stone-600">Motivo: {v.motivo_correccion}</span>}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </article>
      ))}
    </>
  );
}

/** Estado comercial, contra-análisis y línea de tiempo leídos del contrato (solo con anclaje en Stellar). */
export function useDetalleComercial(loteId: string, recarga = 0) {
  const info = useInfoMercado();
  const [detalle, setDetalle] = useState<DetalleComercial | null>(null);
  const [error, setError] = useState<string | null>(null);
  const habilitado = info?.habilitado === true;

  useEffect(() => {
    if (!habilitado) return;
    let vigente = true;
    api<DetalleComercial>(`/mercado/lotes/${encodeURIComponent(loteId)}`)
      .then((d) => {
        if (vigente) {
          setDetalle(d);
          setError(null);
        }
      })
      .catch((e) => vigente && setError(e instanceof ErrorApi ? e.message : 'No se pudo leer el contrato'));
    return () => {
      vigente = false;
    };
  }, [loteId, habilitado, recarga]);

  return { info, detalle, error };
}

/** Sección de la página pública: estado comercial, contra-análisis y línea de tiempo. */
export function SeccionComercial({ loteId, recarga, acciones }: { loteId: string; recarga?: number; acciones?: ReactNode }) {
  const { info, detalle, error } = useDetalleComercial(loteId, recarga);
  if (!info?.habilitado) return null;
  if (error) return <p className="tarjeta p-6 text-sm text-red-700">Estado comercial: {error}</p>;
  if (!detalle) return <p className="tarjeta p-6 text-sm text-stone-500">Leyendo el estado comercial en el contrato…</p>;

  return (
    <>
      <section className="tarjeta space-y-4 p-6">
        <h2 className="font-semibold">Estado comercial</h2>
        {detalle.estado ? (
          <ResumenComercial estado={detalle.estado} token={info.token} toleranciaBps={info.tolerancia_bps} />
        ) : (
          <p className="text-sm text-stone-500">Este lote aún no está registrado en el contrato.</p>
        )}
        {acciones}
      </section>

      {detalle.contra_analisis.length > 0 && (
        <section className="tarjeta space-y-4 p-6">
          <h2 className="font-semibold">Contra-análisis</h2>
          {detalle.contra_analisis.map((c) => (
            <div key={c.id} className="space-y-3 border-t border-stone-100 pt-4 first:border-0 first:pt-0">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <strong>{c.laboratorio_nombre}</strong>
                <span className="font-mono">{c.pureza}%</span>
                <span className="text-stone-500">
                  {c.metodo} · {formatoFechaHora(c.fecha_analisis)}
                </span>
                <PillContra estado={c.verificacion.estado} />
              </div>
              {c.verificacion.motivos.length > 0 && (
                <ul className="list-inside list-disc text-xs text-stone-600">
                  {c.verificacion.motivos.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <Composicion composicion={c.composicion} />
                <dl className="space-y-2 text-xs">
                  <div>
                    <dt className="text-stone-500">Hash del contra-análisis</dt>
                    <dd>
                      <Hash valor={c.verificacion.hash_recalculado} etiqueta="hash del contra-análisis" />
                    </dd>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <a href={c.url_explorador} target="_blank" rel="noreferrer" className="text-mineral-700 hover:underline">
                      Transacción ↗
                    </a>
                    <a href={`/api/publico/contra-analisis/${c.id}/informe.pdf`} target="_blank" rel="noreferrer" className="text-mineral-700 hover:underline">
                      Informe PDF ↗
                    </a>
                    <a href={`/api/publico/contra-analisis/${c.id}/canonico.json`} className="text-mineral-700 hover:underline">
                      Registro canónico
                    </a>
                  </div>
                </dl>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="tarjeta p-6">
        <h2 className="mb-4 font-semibold">Línea de tiempo</h2>
        <Cronologia eventos={detalle.cronologia} token={info.token} />
      </section>
    </>
  );
}

function PillContra({ estado }: { estado: 'integro' | 'alterado' | 'no_verificable' }) {
  const estilos = {
    integro: ['Íntegro', 'bg-emerald-600 text-white'],
    alterado: ['Alterado', 'bg-red-600 text-white'],
    no_verificable: ['No verificable en el contrato', 'bg-stone-200 text-stone-700'],
  } as const;
  const [texto, clases] = estilos[estado];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${clases}`}>{texto}</span>;
}
