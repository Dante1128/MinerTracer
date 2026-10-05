import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  getAddress,
  getNetworkDetails,
  isConnected,
  requestAccess,
  signTransaction,
  WatchWalletChanges,
} from '@stellar/freighter-api';

/** MinerTrace opera solo en testnet. */
export const PASSPHRASE_TESTNET = 'Test SDF Network ; September 2015';
const CLAVE_CONECTADA = 'minertrace.wallet';

interface Wallet {
  /** null mientras se comprueba si la extensión está instalada. */
  instalada: boolean | null;
  direccion: string | null;
  /** Nombre de la red elegida en Freighter (TESTNET, PUBLIC…). */
  red: string | null;
  redCorrecta: boolean;
  conectando: boolean;
  error: string | null;
  conectar: () => Promise<void>;
  desconectar: () => void;
  /** Pide la firma a Freighter; lanza ErrorWallet con un mensaje claro si no se firma. */
  firmar: (xdr: string) => Promise<string>;
}

export class ErrorWallet extends Error {}

const ContextoWallet = createContext<Wallet | null>(null);

const recordar = (valor: boolean) => {
  try {
    if (valor) localStorage.setItem(CLAVE_CONECTADA, '1');
    else localStorage.removeItem(CLAVE_CONECTADA);
  } catch {
    // Sin almacenamiento: se vuelve a pedir la conexión al recargar.
  }
};
const recordada = () => {
  try {
    return localStorage.getItem(CLAVE_CONECTADA) === '1';
  } catch {
    return false;
  }
};

/** Traduce los errores de Freighter a mensajes para el usuario. */
function mensajeFreighter(mensaje: string): string {
  if (/reject|declin|denied/i.test(mensaje)) return 'Firma rechazada en Freighter.';
  if (/internal error/i.test(mensaje)) return 'Freighter no respondió. Compruebe que la extensión esté instalada y desbloqueada.';
  return mensaje;
}

export function ProveedorWallet({ children }: { children: ReactNode }) {
  const [instalada, setInstalada] = useState<boolean | null>(null);
  const [direccion, setDireccion] = useState<string | null>(null);
  const [red, setRed] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState<string | null>(null);
  const [conectando, setConectando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const leerRed = useCallback(async () => {
    const detalles = await getNetworkDetails();
    if (!detalles.error) {
      setRed(detalles.network);
      setPassphrase(detalles.networkPassphrase);
    }
  }, []);

  // Al cargar: ¿está Freighter? Si el usuario ya se había conectado, se recupera su cuenta sin abrir ventanas.
  useEffect(() => {
    let vigente = true;
    void (async () => {
      const { isConnected: hay } = await isConnected().catch(() => ({ isConnected: false }));
      if (!vigente) return;
      setInstalada(hay);
      if (!hay || !recordada()) return;
      const { address } = await getAddress();
      if (vigente && address) {
        setDireccion(address);
        await leerRed();
      }
    })();
    return () => {
      vigente = false;
    };
  }, [leerRed]);

  // Cambios de cuenta o de red hechos en la extensión.
  useEffect(() => {
    if (!direccion) return;
    const vigilante = new WatchWalletChanges(3000);
    vigilante.watch((cambios) => {
      if (cambios.address) setDireccion(cambios.address);
      setRed(cambios.network);
      setPassphrase(cambios.networkPassphrase);
    });
    return () => vigilante.stop();
  }, [direccion]);

  const conectar = async () => {
    setError(null);
    setConectando(true);
    try {
      const { isConnected: hay } = await isConnected();
      setInstalada(hay);
      if (!hay) throw new ErrorWallet('Instale la extensión Freighter para conectar su wallet.');
      const acceso = await requestAccess();
      if (acceso.error) throw new ErrorWallet(mensajeFreighter(acceso.error.message));
      setDireccion(acceso.address);
      recordar(true);
      await leerRed();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo conectar la wallet');
    } finally {
      setConectando(false);
    }
  };

  // Freighter no tiene "desconectar": se olvida la cuenta en esta aplicación.
  const desconectar = () => {
    recordar(false);
    setDireccion(null);
    setRed(null);
    setPassphrase(null);
  };

  const redCorrecta = passphrase === PASSPHRASE_TESTNET;

  const firmar = async (xdr: string) => {
    if (!direccion) throw new ErrorWallet('Conecte su wallet para firmar.');
    if (!redCorrecta) throw new ErrorWallet(`Freighter está en ${red ?? 'otra red'}. Cambie a Testnet en la extensión.`);
    const resultado = await signTransaction(xdr, { networkPassphrase: PASSPHRASE_TESTNET, address: direccion });
    if (resultado.error) throw new ErrorWallet(mensajeFreighter(resultado.error.message));
    if (resultado.signerAddress && resultado.signerAddress !== direccion) {
      throw new ErrorWallet('Freighter firmó con otra cuenta. Elija la cuenta conectada e inténtelo de nuevo.');
    }
    return resultado.signedTxXdr;
  };

  return (
    <ContextoWallet.Provider
      value={{ instalada, direccion, red, redCorrecta, conectando, error, conectar, desconectar, firmar }}
    >
      {children}
    </ContextoWallet.Provider>
  );
}

export function useWallet(): Wallet {
  const wallet = useContext(ContextoWallet);
  if (!wallet) throw new Error('useWallet fuera de ProveedorWallet');
  return wallet;
}
