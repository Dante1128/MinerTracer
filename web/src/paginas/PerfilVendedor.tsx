import { Link, useParams } from 'react-router';
import { TarjetaLote } from '../componentes/Mercado.tsx';
import { agruparPorVendedor, useInfoMercado, useLotesMercado } from '../mercado.ts';

export function PerfilVendedor() {
  const { id = '' } = useParams();
  const info = useInfoMercado();
  const { lotes, error } = useLotesMercado(info?.habilitado);
  const vendedor = agruparPorVendedor(lotes ?? []).find((v) => v.id === id);

  if (info?.habilitado === false) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">El mercado no está habilitado</h1>
        <Link to="/mercado" className="boton-primario mt-6">Volver al mercado</Link>
      </div>
    );
  }
  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">{error}</h1>
        <Link to="/mercado" className="boton-primario mt-6">Volver al mercado</Link>
      </div>
    );
  }
  if (lotes === null) return <p className="py-16 text-center text-stone-500">Cargando…</p>;
  if (!vendedor) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Este vendedor no tiene lotes en venta por ahora</h1>
        <Link to="/mercado" className="boton-primario mt-6">Volver al mercado</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Link to="/mercado" className="text-sm text-stone-500 hover:text-stone-800">
        ← Mercado
      </Link>
      <header className="mt-2">
        <h1 className="text-3xl font-bold tracking-tight">{vendedor.nombre}</h1>
        <p className="mt-1 font-mono text-xs text-stone-500" title={vendedor.id}>{vendedor.id}</p>
        <p className="mt-3 max-w-3xl text-stone-600">
          {vendedor.lotes.length} {vendedor.lotes.length === 1 ? 'lote en venta' : 'lotes en venta'}
          {vendedor.minerales.length > 0 && ` · ${vendedor.minerales.join(' · ')}`}
        </p>
        {vendedor.laboratorios.length > 0 && (
          <p className="mt-1 text-sm text-stone-500">Certificado por {vendedor.laboratorios.join(' · ')}</p>
        )}
      </header>

      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {vendedor.lotes.map((l) => (
          <TarjetaLote key={l.lote_id} lote={l} token={info!.token} />
        ))}
      </div>
    </div>
  );
}
