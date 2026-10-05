import { Link, useParams } from 'react-router';
import { AnalisisDelLote, SeccionComercial, useVerificacionLote } from '../componentes/VerificacionLote.tsx';
import { formatoPeso } from '../formato.ts';

export function ResultadoLote() {
  const { loteId = '' } = useParams();
  const { resultado, error } = useVerificacionLote(loteId);

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

      <AnalisisDelLote resultado={resultado} />
      <SeccionComercial
        loteId={lote.id}
        acciones={
          <Link to={`/mercado/${lote.id}`} className="text-sm font-medium text-mineral-700 hover:underline">
            Ver en el mercado →
          </Link>
        }
      />

      <p className="text-xs text-stone-500">
        MinerTrace garantiza la integridad del registro digital desde su anclaje, no la exactitud de la medición física, que
        depende del laboratorio y sus acreditaciones.
      </p>
    </div>
  );
}
