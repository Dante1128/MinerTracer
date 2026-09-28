import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ErrorApi, type ResultadoLote as Resultado } from '../api.ts';
import { PillVerificacion } from '../componentes/Insignias.tsx';
import { BannerVerificacion, DatosAnalisis, Evidencia } from '../componentes/Verificacion.tsx';
import { formatoFechaHora, formatoPeso } from '../formato.ts';

export function ResultadoLote() {
  const { loteId = '' } = useParams();
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    let temporizador: ReturnType<typeof setTimeout>;
    const cargar = async () => {
      try {
        const r = await api<Resultado>(`/publico/lotes/${encodeURIComponent(loteId)}`);
        if (!vigente) return;
        setResultado(r);
        setError(null);
        // Mientras haya anclajes en curso, se vuelve a consultar.
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

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-5xl">🔍</p>
        <h1 className="mt-4 text-2xl font-bold">{error}</h1>
        <p className="mt-2 text-stone-600">
          Código consultado: <code className="font-mono">{loteId}</code>
        </p>
        <Link to="/verificar" className="boton-primario mt-6">
          Probar con otro código
        </Link>
      </div>
    );
  }
  if (!resultado) return <p className="py-16 text-center text-stone-500">Verificando…</p>;

  const { lote, laboratorio } = resultado;
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <header>
        <p className="text-sm font-semibold tracking-widest text-mineral-700 uppercase">Verificación de lote</p>
        <h1 className="font-mono text-3xl font-bold">{lote.id}</h1>
        <p className="mt-1 text-stone-600">
          {lote.tipo_mineral} · {formatoPeso(lote.peso_kg)} · {lote.origen}
        </p>
        <p className="mt-1 text-sm text-stone-500">
          Laboratorio: <strong className="text-stone-700">{laboratorio.nombre}</strong> ({laboratorio.id})
          {laboratorio.acreditaciones.length > 0 && ` · ${laboratorio.acreditaciones.join(', ')}`}
        </p>
      </header>

      {resultado.analisis.length === 0 && (
        <p className="tarjeta p-6 text-stone-600">Este lote todavía no tiene análisis registrados.</p>
      )}

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

      <p className="text-xs text-stone-500">
        MinerTrace garantiza la integridad del registro digital desde su anclaje, no la exactitud de la medición física, que
        depende del laboratorio y sus acreditaciones.
      </p>
    </div>
  );
}
