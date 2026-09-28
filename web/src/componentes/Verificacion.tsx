import type { AnalisisVerificado } from '../api.ts';
import { formatoFecha, formatoFechaHora } from '../formato.ts';
import { Composicion, ESTILO_VERIFICACION, Hash } from './Insignias.tsx';

const urlVersion = (a: AnalisisVerificado, archivo: string) =>
  `/api/publico/analisis/${encodeURIComponent(a.analisis_id)}/v/${a.version}/${archivo}`;

function resumen(a: AnalisisVerificado, laboratorio: string) {
  const fecha = formatoFecha(a.verificacion.anclaje?.fecha ?? a.creado_en);
  switch (a.verificacion.estado) {
    case 'integro':
      return `Los datos coinciden con el análisis registrado por ${laboratorio} el ${fecha}.`;
    case 'alterado':
      return `Los datos actuales no corresponden al análisis registrado el ${fecha} por ${laboratorio}.`;
    case 'pendiente':
      return 'El análisis está registrado y su huella se está anclando. Vuelva a verificar en unos segundos.';
    default:
      return 'No se pudo consultar la evidencia en este momento. Intente más tarde.';
  }
}

function Comprobacion({ ok, texto }: { ok: boolean | null; texto: string }) {
  const [icono, color] = ok === null ? ['○', 'text-stone-400'] : ok ? ['✓', 'text-emerald-600'] : ['✕', 'text-red-600'];
  return (
    <li className="flex gap-2">
      <span className={`font-bold ${color}`} aria-hidden>
        {icono}
      </span>
      <span className={ok === false ? 'font-medium text-red-700' : ''}>{texto}</span>
    </li>
  );
}

export function BannerVerificacion({ analisis, laboratorio }: { analisis: AnalisisVerificado; laboratorio: string }) {
  const v = analisis.verificacion;
  const estilo = ESTILO_VERIFICACION[v.estado];
  return (
    <div className={`rounded-2xl p-5 ${estilo.clases}`} role="status">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20 text-xl font-bold" aria-hidden>
          {estilo.icono}
        </span>
        <div>
          <p className="text-xl font-bold">{estilo.titulo}</p>
          <p className="text-sm opacity-90">{resumen(analisis, laboratorio)}</p>
        </div>
      </div>
      {v.estado === 'alterado' && v.motivos.length > 0 && (
        <ul className="mt-3 list-inside list-disc text-sm opacity-95">
          {v.motivos.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DatosAnalisis({ analisis }: { analisis: AnalisisVerificado }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div className="col-span-2">
          <dt className="text-stone-500">Pureza registrada</dt>
          <dd className="font-mono text-3xl font-bold">{analisis.pureza}%</dd>
        </div>
        <div>
          <dt className="text-stone-500">Análisis</dt>
          <dd className="font-mono">
            {analisis.analisis_id} · v{analisis.version}
          </dd>
        </div>
        <div>
          <dt className="text-stone-500">Método</dt>
          <dd>{analisis.metodo}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Fecha del análisis</dt>
          <dd>{formatoFechaHora(analisis.fecha_analisis)}</dd>
        </div>
        <div>
          <dt className="text-stone-500">Analista</dt>
          <dd>{analisis.analista_nombre}</dd>
        </div>
        {analisis.motivo_correccion && (
          <div className="col-span-2">
            <dt className="text-stone-500">Motivo de la corrección</dt>
            <dd>{analisis.motivo_correccion}</dd>
          </div>
        )}
        {analisis.observaciones && (
          <div className="col-span-2">
            <dt className="text-stone-500">Observaciones</dt>
            <dd>{analisis.observaciones}</dd>
          </div>
        )}
        <div className="col-span-2">
          <a href={urlVersion(analisis, 'informe.pdf')} target="_blank" rel="noreferrer" className="text-sm font-medium text-mineral-700 hover:underline">
            Ver informe PDF ({analisis.pdf_nombre}) ↗
          </a>
        </div>
      </dl>
      <div>
        <p className="mb-2 text-sm text-stone-500">Composición química</p>
        <Composicion composicion={analisis.composicion} />
      </div>
    </div>
  );
}

export function Evidencia({ analisis }: { analisis: AnalisisVerificado }) {
  const v = analisis.verificacion;
  const archivo = `${analisis.analisis_id}-v${analisis.version}.canonico.json`;
  return (
    <div className="space-y-5 text-sm">
      <ul className="space-y-1.5">
        <Comprobacion ok={v.comprobaciones.datos} texto="Los datos actuales producen el mismo hash que el anclado" />
        <Comprobacion ok={v.comprobaciones.firma} texto="La transacción fue firmada por la cuenta del laboratorio" />
        <Comprobacion ok={v.comprobaciones.pdf} texto="El informe PDF coincide con la huella registrada" />
      </ul>

      <dl className="space-y-3">
        <div>
          <dt className="text-stone-500">Hash recalculado con los datos actuales</dt>
          <dd>
            <Hash valor={v.hash_recalculado} etiqueta="hash recalculado" />
          </dd>
        </div>
        <div>
          <dt className="text-stone-500">Hash anclado en la blockchain</dt>
          <dd className={v.comprobaciones.datos === false ? 'rounded bg-red-50 p-1' : ''}>
            <Hash valor={v.hash_anclado} etiqueta="hash anclado" />
          </dd>
        </div>
        {v.anclaje && (
          <>
            <div>
              <dt className="text-stone-500">Transacción ({v.anclaje.red === 'mock' ? 'simulada, Fase 1' : v.anclaje.red})</dt>
              <dd>
                <Hash valor={v.anclaje.tx_id} etiqueta="ID de transacción" />
                {v.anclaje.url_explorador && (
                  <a href={v.anclaje.url_explorador} target="_blank" rel="noreferrer" className="ml-1 text-mineral-700 hover:underline">
                    Ver en el explorador ↗
                  </a>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-stone-500">Anclado el</dt>
              <dd>{formatoFechaHora(v.anclaje.fecha)}</dd>
            </div>
            <div>
              <dt className="text-stone-500">Cuenta firmante</dt>
              <dd>
                <Hash valor={v.anclaje.cuenta} etiqueta="cuenta firmante" />
              </dd>
            </div>
          </>
        )}
        <div>
          <dt className="text-stone-500">SHA-256 del informe PDF</dt>
          <dd>
            <Hash valor={analisis.pdf_sha256} etiqueta="hash del PDF" />
          </dd>
        </div>
      </dl>

      <details className="rounded-lg bg-stone-50 p-3">
        <summary className="cursor-pointer font-medium">Verificar por su cuenta, sin confiar en MinerTrace</summary>
        <ol className="mt-3 list-inside list-decimal space-y-2 text-stone-700">
          <li>
            Descargue el{' '}
            <a href={urlVersion(analisis, 'canonico.json')} className="font-medium text-mineral-700 hover:underline">
              registro canónico
            </a>{' '}
            (JSON RFC 8785). Es exactamente el texto que se hasheó.
          </li>
          <li>
            Calcule su SHA-256 con cualquier herramienta:
            <code className="mt-1 block rounded bg-stone-900 p-2 text-xs text-stone-100">
              sha256sum {archivo}
              <br />
              # Windows: certutil -hashfile {archivo} SHA256
            </code>
          </li>
          <li>Compare el resultado con el hash de la transacción en un explorador público de Stellar.</li>
          <li>Opcional: calcule el SHA-256 del PDF y compárelo con el campo pdf_sha256 del registro canónico.</li>
        </ol>
        {analisis.estado_anclaje === 'anclado' && !v.anclaje?.url_explorador && (
          <p className="mt-3 text-xs text-stone-500">
            Fase 1: el anclaje es simulado; el enlace al explorador de Stellar estará disponible en la Fase 2.
          </p>
        )}
      </details>
    </div>
  );
}
