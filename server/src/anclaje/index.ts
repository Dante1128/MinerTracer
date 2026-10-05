import { config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { AnclajeMock } from './AnclajeMock.ts';
import { AnclajeStellar } from './AnclajeStellar.ts';
import type { ServicioAnclaje } from './ServicioAnclaje.ts';

export function crearServicioAnclaje(db: Db): ServicioAnclaje {
  switch (config.anclaje.proveedor) {
    case 'mock':
      return new AnclajeMock(db, {
        retrasoMs: config.anclaje.mockRetrasoMs,
        tasaFallo: config.anclaje.mockTasaFallo,
      });
    case 'stellar':
      if (!config.stellar.contratoId) {
        throw new Error('ANCLAJE=stellar requiere STELLAR_CONTRATO_ID (npm run contrato:desplegar)');
      }
      return new AnclajeStellar({ ...config.stellar, firmaConWallet: config.stellar.firmaLaboratorio === 'wallet' });
    default:
      throw new Error(`Proveedor de anclaje desconocido: ${config.anclaje.proveedor}`);
  }
}
