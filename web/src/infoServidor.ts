import { useEffect, useState } from 'react';
import { api, type InfoServidor } from './api.ts';

// Se consulta una sola vez por carga de la página.
let consulta: Promise<InfoServidor | null> | null = null;

/** Configuración pública del servidor (red de anclaje, contrato, demo); null mientras carga o si falla. */
export function useInfoServidor(): InfoServidor | null {
  const [info, setInfo] = useState<InfoServidor | null>(null);
  useEffect(() => {
    let vigente = true;
    consulta ??= api<InfoServidor>('/publico/info').catch(() => {
      consulta = null;
      return null;
    });
    void consulta.then((i) => vigente && setInfo(i));
    return () => {
      vigente = false;
    };
  }, []);
  return info;
}

/** El anclaje es real (Stellar) y no simulado. */
export const anclajeReal = (info: InfoServidor | null) => info !== null && info.red !== 'simulada';
