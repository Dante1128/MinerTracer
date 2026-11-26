import type { Consultas } from '../db/index.ts';
import type { PerfilPublico } from '../comercio/tipos.ts';

/** El escaparate solo recibe la declaración pública; contacto y documento quedan fuera de la consulta. */
export async function buscarPublicoPorCuenta(db: Consultas, cuenta: string): Promise<PerfilPublico | null> {
  const [fila] = await db.query<Omit<PerfilPublico, 'verificado'>>(
    'SELECT cuenta,nombre,organizacion,tipo,zona FROM comercio_perfiles WHERE cuenta=$1', [cuenta],
  );
  return fila ? { cuenta: fila.cuenta, nombre: fila.nombre, organizacion: fila.organizacion, tipo: fila.tipo, zona: fila.zona, verificado: false } : null;
}
