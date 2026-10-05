/**
 * Errores tipados del contrato (enum `Error` de contracts/minertrace/src/lib.rs).
 * El cliente JS solo entrega el código, dentro del texto de la simulación
 * ("Error(Contract, #6)"); aquí se traduce a un mensaje.
 */
export const ERRORES_CONTRATO: Record<number, string> = {
  1: 'El laboratorio no está autorizado en el contrato',
  2: 'El laboratorio no existe en el contrato',
  3: 'La pureza supera el 100 %',
  4: 'La tolerancia supera el 100 %',
  5: 'La versión debe ser 1 o mayor',
  6: 'Esa versión del análisis ya está registrada en el contrato',
  7: 'La versión anterior aún no está registrada en el contrato',
  8: 'El hash anterior no coincide con el de la versión registrada',
  9: 'Solo el laboratorio de la versión anterior puede registrar una nueva',
  10: 'La versión anterior pertenece a otro lote',
  11: 'El análisis no existe en el contrato',
  12: 'El lote no existe en el contrato',
  13: 'La cuenta no es la dueña del lote',
  14: 'El estado del lote no permite esta operación',
  15: 'El laboratorio que certificó el lote fue revocado',
  16: 'El precio debe ser mayor que cero',
  17: 'El vendedor no puede comprar su propio lote',
  18: 'El contra-análisis debe hacerlo otro laboratorio',
  19: 'El lote ya tiene un contra-análisis',
  20: 'La cuenta no es la compradora del lote',
  21: 'El lote está en disputa',
  22: 'El lote no tiene una venta en curso',
  23: 'El lote no tiene contra-análisis',
  24: 'El plazo de la garantía debe ser mayor que cero',
  25: 'Todavía no venció el plazo de la garantía',
  26: 'La cuenta no es la vendedora del lote',
};

export const VERSION_DUPLICADA = 6;
export const ANALISIS_INEXISTENTE = 11;

export class ErrorContrato extends Error {
  codigo: number;
  constructor(codigo: number) {
    super(ERRORES_CONTRATO[codigo] ?? `Error del contrato #${codigo}`);
    this.name = 'ErrorContrato';
    this.codigo = codigo;
  }
}

/** Extrae el código de "Error(Contract, #N)" de un mensaje de error o de simulación. */
export function codigoErrorContrato(texto: unknown): number | null {
  const m = /Error\(Contract, #(\d+)\)/.exec(String(texto ?? ''));
  return m ? Number(m[1]) : null;
}
