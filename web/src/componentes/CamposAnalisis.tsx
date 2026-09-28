import type { Analisis } from '../api.ts';

export interface DatosFormularioAnalisis {
  fecha_analisis: string; // formato <input type="datetime-local"> (hora local)
  metodo: string;
  pureza: string;
  composicion: { elemento: string; porcentaje: string }[];
  observaciones: string;
  pdf: File | null;
}

export const METODOS = ['FRX', 'Ensayo al fuego', 'ICP-OES', 'Absorción atómica (AAS)', 'Volumetría'];

const aLocal = (fecha: Date) => {
  const d = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

export function datosIniciales(base?: Analisis): DatosFormularioAnalisis {
  if (!base) {
    return {
      fecha_analisis: aLocal(new Date()),
      metodo: 'FRX',
      pureza: '',
      composicion: [
        { elemento: '', porcentaje: '' },
        { elemento: 'otros', porcentaje: '' },
      ],
      observaciones: '',
      pdf: null,
    };
  }
  return {
    fecha_analisis: aLocal(new Date(base.fecha_analisis)),
    metodo: base.metodo,
    pureza: base.pureza,
    composicion: Object.entries(base.composicion).map(([elemento, porcentaje]) => ({ elemento, porcentaje })),
    observaciones: base.observaciones,
    pdf: null,
  };
}

/** Agrega los campos del análisis a un FormData listo para enviar a la API. */
export function aFormData(datos: DatosFormularioAnalisis, form = new FormData()): FormData {
  form.set('fecha_analisis', datos.fecha_analisis ? new Date(datos.fecha_analisis).toISOString() : '');
  form.set('metodo', datos.metodo);
  form.set('pureza', datos.pureza);
  form.set(
    'composicion',
    JSON.stringify(
      Object.fromEntries(datos.composicion.filter((f) => f.elemento.trim()).map((f) => [f.elemento.trim(), f.porcentaje])),
    ),
  );
  form.set('observaciones', datos.observaciones);
  if (datos.pdf) form.set('pdf', datos.pdf);
  return form;
}

export function MensajeError({ texto }: { texto?: string }) {
  return texto ? <p className="mt-1 text-xs font-medium text-red-600">{texto}</p> : null;
}

export function CamposAnalisis({
  datos,
  cambiar,
  errores,
  pdfObligatorio,
}: {
  datos: DatosFormularioAnalisis;
  cambiar: (d: DatosFormularioAnalisis) => void;
  errores: Record<string, string>;
  pdfObligatorio: boolean;
}) {
  const set = <K extends keyof DatosFormularioAnalisis>(campo: K, valor: DatosFormularioAnalisis[K]) =>
    cambiar({ ...datos, [campo]: valor });
  const setFila = (i: number, campo: 'elemento' | 'porcentaje', valor: string) =>
    set(
      'composicion',
      datos.composicion.map((f, j) => (j === i ? { ...f, [campo]: valor } : f)),
    );

  const total = datos.composicion.reduce((s, f) => s + (Number(f.porcentaje.replace(',', '.')) || 0), 0);
  const erroresComposicion = Object.entries(errores)
    .filter(([k]) => k.startsWith('composicion'))
    .map(([k, v]) => (k === 'composicion' ? v : `${k.split('.')[1]}: ${v}`));

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="etiqueta" htmlFor="fecha_analisis">
          Fecha y hora del análisis
        </label>
        <input
          id="fecha_analisis"
          type="datetime-local"
          className="campo"
          value={datos.fecha_analisis}
          onChange={(e) => set('fecha_analisis', e.target.value)}
          required
        />
        <MensajeError texto={errores.fecha_analisis} />
      </div>
      <div>
        <label className="etiqueta" htmlFor="metodo">
          Método
        </label>
        <input
          id="metodo"
          list="metodos"
          className="campo"
          value={datos.metodo}
          onChange={(e) => set('metodo', e.target.value)}
          required
        />
        <datalist id="metodos">
          {METODOS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <MensajeError texto={errores.metodo} />
      </div>

      <div>
        <label className="etiqueta" htmlFor="pureza">
          Pureza / ley del mineral principal (%)
        </label>
        <input
          id="pureza"
          inputMode="decimal"
          className="campo font-mono"
          placeholder="75.00"
          value={datos.pureza}
          onChange={(e) => set('pureza', e.target.value)}
          required
        />
        <MensajeError texto={errores.pureza} />
      </div>

      <div className="sm:col-span-2">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="etiqueta mb-0">Composición química</span>
          <span className={`font-mono text-xs ${total > 100.001 ? 'font-semibold text-red-600' : 'text-stone-500'}`}>
            Total: {total.toFixed(2)}%
          </span>
        </div>
        <div className="space-y-2">
          {datos.composicion.map((fila, i) => (
            <div key={i} className="flex gap-2">
              <input
                aria-label="Símbolo químico"
                className="campo w-28 font-mono"
                placeholder="Sn"
                value={fila.elemento}
                onChange={(e) => setFila(i, 'elemento', e.target.value)}
              />
              <input
                aria-label="Porcentaje"
                inputMode="decimal"
                className="campo font-mono"
                placeholder="0.00"
                value={fila.porcentaje}
                onChange={(e) => setFila(i, 'porcentaje', e.target.value)}
              />
              <button
                type="button"
                className="boton-secundario px-3"
                onClick={() => set('composicion', datos.composicion.filter((_, j) => j !== i))}
                disabled={datos.composicion.length === 1}
                aria-label="Quitar elemento"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="mt-2 text-sm font-medium text-mineral-700 hover:underline"
          onClick={() => set('composicion', [...datos.composicion, { elemento: '', porcentaje: '' }])}
        >
          + Agregar elemento
        </button>
        <p className="mt-1 text-xs text-stone-500">Símbolos químicos (Sn, Ag, Pb, Zn…) o "otros". Hasta 2 decimales.</p>
        {erroresComposicion.map((e) => (
          <MensajeError key={e} texto={e} />
        ))}
      </div>

      <div className="sm:col-span-2">
        <label className="etiqueta" htmlFor="observaciones">
          Observaciones
        </label>
        <textarea
          id="observaciones"
          rows={2}
          className="campo"
          value={datos.observaciones}
          onChange={(e) => set('observaciones', e.target.value)}
        />
        <MensajeError texto={errores.observaciones} />
      </div>

      <div className="sm:col-span-2">
        <label className="etiqueta" htmlFor="pdf">
          Informe PDF firmado {pdfObligatorio ? '' : '(opcional: si no adjunta uno, se conserva el de la versión anterior)'}
        </label>
        <input
          id="pdf"
          type="file"
          accept="application/pdf,.pdf"
          className="block w-full text-sm text-stone-600 file:mr-3 file:rounded-lg file:border-0 file:bg-stone-900 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-stone-700"
          onChange={(e) => set('pdf', e.target.files?.[0] ?? null)}
          required={pdfObligatorio}
        />
        <p className="mt-1 text-xs text-stone-500">
          Se calcula su huella SHA-256 y queda sellada en el registro: cualquier cambio posterior en el archivo se detecta.
        </p>
      </div>
    </div>
  );
}
