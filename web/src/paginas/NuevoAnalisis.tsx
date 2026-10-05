import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ErrorApi, type Analisis, type Lote } from '../api.ts';
import { CamposAnalisis, MensajeError, aFormData, datosIniciales } from '../componentes/CamposAnalisis.tsx';

const LOTE_VACIO = { codigo: '', tipo_mineral: '', peso_kg: '', origen: '', coordenadas: '', dueno: '' };

export function NuevoAnalisis() {
  const navegar = useNavigate();
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [loteId, setLoteId] = useState('');
  const [nuevoLote, setNuevoLote] = useState(LOTE_VACIO);
  const [crearLote, setCrearLote] = useState(false);
  const [datos, setDatos] = useState(datosIniciales);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [erroresLote, setErroresLote] = useState<Record<string, string>>({});
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api<Lote[]>('/lotes')
      .then((l) => {
        setLotes(l);
        if (l.length === 0) setCrearLote(true);
      })
      .catch(() => setCrearLote(true));
  }, []);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErrores({});
    setErroresLote({});
    setMensaje(null);
    let fallaEnLote = false;
    try {
      let destino = loteId;
      if (crearLote) {
        try {
          const lote = await api<Lote>('/lotes', { json: nuevoLote });
          // Si el análisis falla luego, el lote ya existe: se selecciona para no crearlo dos veces.
          setLotes((l) => [lote, ...l]);
          setLoteId(lote.id);
          setCrearLote(false);
          destino = lote.id;
        } catch (err) {
          fallaEnLote = true;
          if (err instanceof ErrorApi) setErroresLote(err.errores);
          throw err;
        }
      }
      const form = aFormData(datos);
      form.set('lote_id', destino);
      const creado = await api<Analisis>('/analisis', { form });
      navegar(`/laboratorio/analisis/${creado.analisis_id}`);
    } catch (err) {
      if (err instanceof ErrorApi) {
        setMensaje(err.message);
        if (!fallaEnLote) setErrores(err.errores);
      } else {
        setMensaje('Error inesperado');
      }
    } finally {
      setEnviando(false);
    }
  };

  const setLote = (campo: keyof typeof LOTE_VACIO, valor: string) => setNuevoLote({ ...nuevoLote, [campo]: valor });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link to="/laboratorio" className="text-sm text-stone-500 hover:text-stone-800">
        ← Volver
      </Link>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Registrar análisis</h1>
      <p className="mt-1 text-stone-600">
        Al guardar, el sistema calcula la huella del análisis y la ancla automáticamente. No podrá modificarse después;
        las correcciones se registran como nuevas versiones.
      </p>

      <form onSubmit={enviar} className="mt-8 space-y-6">
        <section className="tarjeta p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">1. Lote</h2>
            {lotes.length > 0 && (
              <button type="button" className="text-sm font-medium text-mineral-700 hover:underline" onClick={() => setCrearLote(!crearLote)}>
                {crearLote ? 'Elegir un lote existente' : '+ Nuevo lote'}
              </button>
            )}
          </div>

          {crearLote ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="etiqueta" htmlFor="codigo">
                  Código del lote (opcional)
                </label>
                <input
                  id="codigo"
                  className="campo font-mono uppercase"
                  placeholder="Automático: LT-2026-0001"
                  value={nuevoLote.codigo}
                  onChange={(e) => setLote('codigo', e.target.value)}
                />
                <MensajeError texto={erroresLote.codigo} />
              </div>
              <div>
                <label className="etiqueta" htmlFor="tipo_mineral">
                  Tipo de mineral
                </label>
                <input
                  id="tipo_mineral"
                  className="campo"
                  placeholder="Concentrado de estaño"
                  value={nuevoLote.tipo_mineral}
                  onChange={(e) => setLote('tipo_mineral', e.target.value)}
                  required
                />
                <MensajeError texto={erroresLote.tipo_mineral} />
              </div>
              <div>
                <label className="etiqueta" htmlFor="peso_kg">
                  Peso (kg)
                </label>
                <input
                  id="peso_kg"
                  inputMode="decimal"
                  className="campo font-mono"
                  value={nuevoLote.peso_kg}
                  onChange={(e) => setLote('peso_kg', e.target.value)}
                  required
                />
                <MensajeError texto={erroresLote.peso_kg} />
              </div>
              <div>
                <label className="etiqueta" htmlFor="coordenadas">
                  Coordenadas (opcional)
                </label>
                <input
                  id="coordenadas"
                  className="campo font-mono"
                  placeholder="-19.5836, -65.7531"
                  value={nuevoLote.coordenadas}
                  onChange={(e) => setLote('coordenadas', e.target.value)}
                />
                <MensajeError texto={erroresLote.coordenadas} />
              </div>
              <div className="sm:col-span-2">
                <label className="etiqueta" htmlFor="origen">
                  Origen (cooperativa, mina, localidad)
                </label>
                <input
                  id="origen"
                  className="campo"
                  placeholder="Cooperativa Minera X, Potosí, Bolivia"
                  value={nuevoLote.origen}
                  onChange={(e) => setLote('origen', e.target.value)}
                  required
                />
                <MensajeError texto={erroresLote.origen} />
              </div>
              <div className="sm:col-span-2">
                <label className="etiqueta" htmlFor="dueno">
                  Dirección Stellar del dueño (opcional)
                </label>
                <input
                  id="dueno"
                  className="campo font-mono"
                  placeholder="G…"
                  spellCheck={false}
                  autoComplete="off"
                  value={nuevoLote.dueno}
                  onChange={(e) => setLote('dueno', e.target.value.trim())}
                />
                <p className="mt-1 text-xs text-stone-500">
                  Cuenta que podrá vender el lote en el marketplace. Si la deja vacía, el lote queda a nombre del laboratorio.
                </p>
                <MensajeError texto={erroresLote.dueno} />
              </div>
            </div>
          ) : (
            <div>
              <label className="etiqueta" htmlFor="lote">
                Lote analizado
              </label>
              <select id="lote" className="campo" value={loteId} onChange={(e) => setLoteId(e.target.value)} required>
                <option value="">Seleccione…</option>
                {lotes.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.id} — {l.tipo_mineral} ({l.origen})
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>

        <section className="tarjeta p-6">
          <h2 className="mb-4 font-semibold">2. Resultados del análisis</h2>
          <CamposAnalisis datos={datos} cambiar={setDatos} errores={errores} pdfObligatorio />
        </section>

        {mensaje && <p className="rounded-lg bg-red-50 p-3 text-sm font-medium text-red-700">{mensaje}</p>}
        <div className="flex justify-end gap-3">
          <Link to="/laboratorio" className="boton-secundario">
            Cancelar
          </Link>
          <button className="boton-primario" disabled={enviando}>
            {enviando ? 'Registrando…' : 'Registrar y anclar'}
          </button>
        </div>
      </form>
    </div>
  );
}
