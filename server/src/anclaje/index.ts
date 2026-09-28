import { config } from '../config.ts';
import type { Db } from '../db/index.ts';
import { AnclajeMock } from './AnclajeMock.ts';
import type { ServicioAnclaje } from './ServicioAnclaje.ts';

export function crearServicioAnclaje(db: Db): ServicioAnclaje {
  switch (config.anclaje.proveedor) {
    case 'mock':
      return new AnclajeMock(db, {
        retrasoMs: config.anclaje.mockRetrasoMs,
        tasaFallo: config.anclaje.mockTasaFallo,
      });
    // TODO WEB3: case 'stellar': return new AnclajeStellar(...) (ver MinerTrace.md, sección 17)
    default:
      throw new Error(`Proveedor de anclaje desconocido: ${config.anclaje.proveedor}`);
  }
}
