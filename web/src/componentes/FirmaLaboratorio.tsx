import { useEffect, useState } from 'react';
import { api, type Analisis } from '../api.ts';
import { useInfoServidor } from '../infoServidor.ts';
import { useFirmaConWallet, type ResultadoTransaccion } from '../mercado.ts';
import { useWallet } from '../wallet.tsx';
import { AvisoWallet, Cuenta, EstadoTransaccion } from './Mercado.tsx';

/** Cuenta Stellar del laboratorio del usuario con sesión (la que debe firmar). */
export function useCuentaLaboratorio(): string | null {
  const [cuenta, setCuenta] = useState<string | null>(null);
  useEffect(() => {
    api<{ laboratorio: { cuenta_publica: string } }>('/auth/yo')
      .then((r) => setCuenta(r.laboratorio.cuenta_publica))
      .catch(() => setCuenta(null));
  }, []);
  return cuenta;
}

/** El análisis espera la firma del laboratorio con su wallet. */
export function esperaFirma(analisis: Pick<Analisis, 'estado_anclaje' | 'firma_servidor'>, firmaWallet: boolean) {
  return firmaWallet && analisis.estado_anclaje === 'pendiente' && !analisis.firma_servidor;
}

/** Wallet conectada y cuenta del laboratorio: avisa si no coinciden. */
export function AvisoCuentaLaboratorio({ cuenta }: { cuenta: string | null }) {
  const wallet = useWallet();
  if (!wallet.direccion || !cuenta || wallet.direccion === cuenta) return <AvisoWallet />;
  return (
    <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
      La wallet conectada (<Cuenta direccion={wallet.direccion} />) no es la del laboratorio. Elija en Freighter la cuenta{' '}
      <span className="font-mono text-xs break-all">{cuenta}</span>.
    </p>
  );
}

/**
 * Firma con Freighter el anclaje de una versión pendiente. El servidor arma la
 * transacción con el hash que él calculó; después de enviarla comprueba el
 * contrato y solo entonces marca el análisis como anclado.
 */
export function FirmaAnalisis({ analisis, alTerminar }: { analisis: Analisis; alTerminar: () => void }) {
  const info = useInfoServidor();
  const cuentaLab = useCuentaLaboratorio();
  const wallet = useWallet();
  const firma = useFirmaConWallet();
  if (!info || !esperaFirma(analisis, info.firma_laboratorio === 'wallet')) return null;

  const ruta = `/analisis/${encodeURIComponent(analisis.analisis_id)}/v/${analisis.version}/firma`;
  const firmar = async () => {
    const r = await firma.ejecutar(
      async (cuenta) => {
        const p = await api<{ xdr?: string; ya_anclado?: boolean; tx_id?: string }>(ruta, { json: { cuenta } });
        if (p.ya_anclado && p.tx_id) {
          // Ya estaba en el contrato: sin xdr no se pide firma.
          return { xdr: undefined, tx_id: p.tx_id, url_explorador: `https://stellar.expert/explorer/testnet/tx/${p.tx_id}`, fecha: '' };
        }
        return p;
      },
      (xdr, cuenta) => api<ResultadoTransaccion>(`${ruta}/enviar`, { json: { cuenta, xdr } }),
    );
    if (r) alTerminar();
  };
  const cuentaIncorrecta = Boolean(wallet.direccion && cuentaLab && wallet.direccion !== cuentaLab);

  return (
    <section className="tarjeta space-y-3 border-mineral-400 p-5 print:hidden">
      <div>
        <h2 className="font-semibold">
          Firmar el anclaje de la versión {analisis.version}
        </h2>
        <p className="mt-1 text-sm text-stone-600">
          El análisis está guardado. Para anclarlo en Stellar, el laboratorio lo firma con su propia wallet: Freighter le
          mostrará la transacción con la huella del análisis.
        </p>
        {cuentaLab && (
          <p className="mt-1 text-xs text-stone-500">
            Cuenta del laboratorio: <span className="font-mono break-all">{cuentaLab}</span>
          </p>
        )}
      </div>
      <AvisoCuentaLaboratorio cuenta={cuentaLab} />
      <button
        className="boton-primario"
        onClick={() => void firmar()}
        disabled={firma.ocupado || !wallet.direccion || !wallet.redCorrecta || cuentaIncorrecta}
      >
        {firma.ocupado ? 'Procesando…' : 'Firmar y anclar con Freighter'}
      </button>
      <EstadoTransaccion paso={firma.paso} error={firma.error} resultado={firma.resultado} />
    </section>
  );
}
