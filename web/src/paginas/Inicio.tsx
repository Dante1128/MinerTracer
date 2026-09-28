import { Link } from 'react-router';

const PASOS = [
  {
    titulo: 'El laboratorio registra',
    texto: 'El analista ingresa los resultados y adjunta el informe PDF. No necesita saber nada de blockchain.',
  },
  {
    titulo: 'Se genera una huella',
    texto: 'Los datos se serializan en formato canónico (RFC 8785) y se calcula su SHA-256, incluyendo la huella del PDF.',
  },
  {
    titulo: 'La huella se ancla en Stellar',
    texto: 'Solo los 32 bytes del hash van a la blockchain pública, firmados por la cuenta del laboratorio.',
  },
  {
    titulo: 'Cualquiera verifica',
    texto: 'Escaneando el QR del lote se recalcula el hash y se compara con el anclado. Si alguien cambió un dato, se nota.',
  },
];

export function Inicio() {
  return (
    <>
      <section className="bg-stone-900 text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-[1.2fr_1fr] md:py-24">
          <div>
            <p className="mb-3 text-sm font-semibold tracking-widest text-mineral-400 uppercase">Trazabilidad mineral</p>
            <h1 className="text-4xl font-bold tracking-tight text-balance md:text-5xl">
              Un análisis de laboratorio que nadie puede alterar sin que se note.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-stone-300">
              MinerTrace sella cada informe con una huella criptográfica anclada en la blockchain pública de Stellar.
              Compradores, auditores y cooperativas pueden comprobar que el 75% que ven es el 75% que midió el laboratorio.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/verificar" className="boton bg-mineral-500 px-5 py-3 text-base text-stone-900 hover:bg-mineral-400">
                Verificar un lote
              </Link>
              <Link to="/laboratorio" className="boton border border-stone-600 px-5 py-3 text-base text-white hover:bg-stone-800">
                Portal del laboratorio
              </Link>
            </div>
          </div>

          <div className="self-center rounded-2xl border border-stone-700 bg-stone-800/60 p-5 font-mono text-sm">
            <p className="text-stone-400">// Lote LT-2026-0457 · LAB-001</p>
            <p className="mt-2">
              <span className="text-stone-400">"pureza":</span> <span className="text-emerald-400">"75.00"</span>
            </p>
            <p className="text-stone-400">SHA-256 → a3f5c8…7b21 ⚓ Stellar</p>
            <div className="my-4 border-t border-dashed border-stone-700" />
            <p className="text-stone-400">// Meses después, alguien edita la base de datos</p>
            <p className="mt-2">
              <span className="text-stone-400">"pureza":</span> <span className="text-red-400">"95.00"</span>
            </p>
            <p className="text-stone-400">SHA-256 → e81d02…c94f ≠ anclado</p>
            <p className="mt-4 rounded-lg bg-red-600/20 px-3 py-2 font-sans font-semibold text-red-300">✕ Registro alterado</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-bold tracking-tight">El problema</h2>
        <p className="mt-3 max-w-3xl text-stone-600">
          El informe de laboratorio define el precio, los impuestos y la reputación de un lote. Pero suele vivir en PDFs y
          bases de datos que cualquiera con acceso puede modificar sin dejar rastro. Cuando hay una disputa entre
          laboratorio, productor y comprador, no existe una evidencia neutral de cuál era el resultado original.
        </p>

        <h2 className="mt-14 text-2xl font-bold tracking-tight">Cómo funciona</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-4">
          {PASOS.map((paso, i) => (
            <li key={paso.titulo} className="tarjeta p-5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-mineral-100 font-bold text-mineral-700">
                {i + 1}
              </span>
              <h3 className="mt-3 font-semibold">{paso.titulo}</h3>
              <p className="mt-1 text-sm text-stone-600">{paso.texto}</p>
            </li>
          ))}
        </ol>

        <div className="mt-14 grid gap-4 md:grid-cols-2">
          <div className="tarjeta border-emerald-200 p-6">
            <h3 className="font-semibold text-emerald-800">Lo que MinerTrace garantiza</h3>
            <ul className="mt-3 space-y-2 text-sm text-stone-700">
              <li>✓ Que un análisis registrado no se modificó después, ni sus datos ni su PDF.</li>
              <li>✓ Qué laboratorio lo registró y cuándo, con evidencia pública.</li>
              <li>✓ Que las correcciones quedan como versiones nuevas, con el historial visible.</li>
              <li>✓ Que cualquiera puede comprobarlo sin confiar en MinerTrace.</li>
            </ul>
          </div>
          <div className="tarjeta p-6">
            <h3 className="font-semibold text-stone-800">Lo que no garantiza</h3>
            <p className="mt-3 text-sm text-stone-700">
              La veracidad del análisis físico. Si una muestra se mide mal o se registra un dato falso desde el inicio, la
              blockchain sellará ese dato con la misma fidelidad. La validez del resultado depende del laboratorio, su
              calibración y sus acreditaciones (por ejemplo, ISO/IEC 17025).
            </p>
          </div>
        </div>

        <div className="mt-14 tarjeta flex flex-col items-start justify-between gap-4 bg-mineral-50 p-6 md:flex-row md:items-center">
          <div>
            <h3 className="font-semibold">Pruébelo con el lote de ejemplo</h3>
            <p className="text-sm text-stone-600">Concentrado de estaño al 75% de una cooperativa de Potosí.</p>
          </div>
          <Link to="/verificar/LT-2026-0457" className="boton-primario">
            Verificar LT-2026-0457 →
          </Link>
        </div>
      </section>
    </>
  );
}
