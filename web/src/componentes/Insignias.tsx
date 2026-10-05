import { useState } from 'react';
import type { Analisis, EstadoVerificacion } from '../api.ts';

export function EstadoAnclaje({
  analisis,
  esperaFirma = false,
}: {
  analisis: Pick<Analisis, 'estado_anclaje' | 'ultimo_error'>;
  /** Pendiente de que el laboratorio firme con su wallet. */
  esperaFirma?: boolean;
}) {
  if (esperaFirma) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-700 ring-1 ring-sky-600/20">
        <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
        Falta la firma del laboratorio
      </span>
    );
  }
  if (analisis.estado_anclaje === 'anclado') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600/20">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Anclado
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-mineral-50 px-2.5 py-0.5 text-xs font-semibold text-mineral-700 ring-1 ring-mineral-600/20"
      title={analisis.ultimo_error ? `Último error: ${analisis.ultimo_error}. Se reintentará automáticamente.` : undefined}
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mineral-500" />
      {analisis.ultimo_error ? 'Pendiente (reintentando)' : 'Pendiente'}
    </span>
  );
}

export const ESTILO_VERIFICACION: Record<EstadoVerificacion, { titulo: string; icono: string; clases: string }> = {
  integro: { titulo: 'Registro íntegro', icono: '✓', clases: 'bg-emerald-600 text-white' },
  alterado: { titulo: 'Registro alterado', icono: '✕', clases: 'bg-red-600 text-white' },
  pendiente: { titulo: 'Anclaje pendiente', icono: '…', clases: 'bg-mineral-500 text-stone-900' },
  error: { titulo: 'No se pudo verificar', icono: '!', clases: 'bg-stone-600 text-white' },
};

export function PillVerificacion({ estado }: { estado: EstadoVerificacion }) {
  const e = ESTILO_VERIFICACION[estado];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${e.clases}`}>
      <span aria-hidden>{e.icono}</span> {e.titulo}
    </span>
  );
}

export function Hash({ valor, etiqueta }: { valor: string | null; etiqueta?: string }) {
  const [copiado, setCopiado] = useState(false);
  if (!valor) return <span className="text-sm text-stone-400">—</span>;
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // Portapapeles no disponible (http sin localhost): el texto sigue seleccionable.
    }
  };
  return (
    <span className="group inline-flex max-w-full items-start gap-2">
      <code className="hash select-all">{valor}</code>
      <button
        type="button"
        onClick={copiar}
        className="shrink-0 rounded px-1.5 text-xs text-stone-400 hover:bg-stone-100 hover:text-stone-700 print:hidden"
        aria-label={`Copiar ${etiqueta ?? 'valor'}`}
      >
        {copiado ? 'Copiado' : 'Copiar'}
      </button>
    </span>
  );
}

export function Composicion({ composicion }: { composicion: Record<string, string> }) {
  const filas = Object.entries(composicion).sort(([a, x], [b, y]) =>
    a === 'otros' ? 1 : b === 'otros' ? -1 : Number(y) - Number(x),
  );
  return (
    <div className="space-y-1.5">
      {filas.map(([elemento, porcentaje]) => (
        <div key={elemento} className="flex items-center gap-3 text-sm">
          <span className="w-12 font-mono font-semibold">{elemento}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-100">
            <div
              className={`h-full rounded-full ${elemento === 'otros' ? 'bg-stone-300' : 'bg-mineral-500'}`}
              style={{ width: `${Math.min(100, Number(porcentaje))}%` }}
            />
          </div>
          <span className="w-16 text-right font-mono tabular-nums">{porcentaje}%</span>
        </div>
      ))}
    </div>
  );
}
