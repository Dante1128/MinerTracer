import type { Db } from '../db/index.ts';
import type { ResultadoAnclaje, ServicioAnclaje, SolicitudAnclaje } from './ServicioAnclaje.ts';

const ESPERA_MAX_MS = 5 * 60 * 1000;
/** Mientras dura la reserva, ningún otro procesador toma el análisis. Debe superar lo que tarda un anclaje. */
const RESERVA_MS = 5 * 60 * 1000;
/** Cada cuánto se revisa en la red un análisis que espera la firma del laboratorio. */
const RECONCILIAR_MS = 60 * 1000;

/** Fila de `analisis` con lo necesario para anclarla. */
export type Pendiente = {
  id: number;
  hash: string;
  laboratorio_id: string;
  intentos_anclaje: number;
  analisis_id: string;
  version: number;
  lote_id: string;
  hash_anterior: string | null;
  pureza: string;
  firma_servidor: boolean;
};

/** Arma la solicitud de anclaje de un análisis: cuenta del laboratorio y dueño del lote. */
export async function solicitudDeAnalisis(db: Db, a: Omit<Pendiente, 'id' | 'intentos_anclaje' | 'firma_servidor'>): Promise<SolicitudAnclaje> {
  const [destino] = await db.query<{ cuenta_publica: string; dueno: string | null }>(
    `SELECT lab.cuenta_publica, l.dueno FROM laboratorios lab, lotes l WHERE lab.id = $1 AND l.id = $2`,
    [a.laboratorio_id, a.lote_id],
  );
  if (!destino) throw new Error(`Laboratorio ${a.laboratorio_id} o lote ${a.lote_id} inexistente`);
  return {
    hash: a.hash,
    laboratorioId: a.laboratorio_id,
    cuentaLaboratorio: destino.cuenta_publica,
    analisisId: a.analisis_id,
    version: a.version,
    loteId: a.lote_id,
    hashAnterior: a.hash_anterior,
    pureza: a.pureza,
    // Sin dueño indicado, el lote queda a nombre del laboratorio.
    dueno: destino.dueno ?? destino.cuenta_publica,
  };
}

/** Marca un análisis como anclado (solo si sigue pendiente). Devuelve si lo marcó. */
export async function marcarAnclado(db: Db, id: number, { txId, fecha }: ResultadoAnclaje): Promise<boolean> {
  const filas = await db.query(
    `UPDATE analisis SET estado_anclaje = 'anclado', tx_id = $2, fecha_anclaje = $3,
       intentos_anclaje = intentos_anclaje + 1, ultimo_error = NULL, proximo_intento = NULL
     WHERE id = $1 AND estado_anclaje = 'pendiente' RETURNING id`,
    [id, txId, fecha],
  );
  return filas.length > 0;
}

/**
 * Ancla los análisis en estado `pendiente` y reintenta con espera exponencial
 * si la red falla. El análisis ya está en la base de datos, así que nunca se
 * pierde.
 *
 * Con firma por wallet (`anclaje.firmaConWallet`), el procesador no firma los
 * análisis del portal: los firma el laboratorio con Freighter. Solo los
 * reconcilia: si la transacción ya llegó a la red (p. ej., se cerró el
 * navegador antes de avisar al servidor), la encuentra y marca el análisis.
 * Los análisis con `firma_servidor` (semilla y pruebas) sí los firma.
 *
 * Varias instancias pueden correr a la vez: cada una reserva sus filas con un
 * UPDATE atómico (FOR UPDATE SKIP LOCKED) que adelanta `proximo_intento`, así
 * que un análisis no se ancla dos veces. Si el proceso muere a mitad, la
 * reserva vence y otro lo reintenta.
 */
export class ProcesadorAnclajes {
  private db: Db;
  private anclaje: ServicioAnclaje;
  private enCurso = false;
  private repetir = false;
  private temporizador: NodeJS.Timeout | null = null;

  constructor(db: Db, anclaje: ServicioAnclaje) {
    this.db = db;
    this.anclaje = anclaje;
  }

  iniciar(intervaloMs = 5000) {
    this.temporizador = setInterval(() => void this.procesar(), intervaloMs);
    void this.procesar();
  }

  detener() {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  /** Procesa todos los pendientes cuyo reintento ya venció. */
  async procesar(): Promise<void> {
    if (this.enCurso) {
      this.repetir = true;
      return;
    }
    this.enCurso = true;
    try {
      do {
        this.repetir = false;
        const pendientes = await this.db.query<Pendiente>(
          `UPDATE analisis SET proximo_intento = now() + ($1 || ' milliseconds')::interval
           WHERE id IN (
             SELECT id FROM analisis
             WHERE estado_anclaje = 'pendiente' AND (proximo_intento IS NULL OR proximo_intento <= now())
             ORDER BY id LIMIT 50
             FOR UPDATE SKIP LOCKED
           )
           RETURNING id, hash, laboratorio_id, intentos_anclaje, analisis_id, version, lote_id, hash_anterior, pureza, firma_servidor`,
          [String(RESERVA_MS)],
        );
        pendientes.sort((a, b) => a.id - b.id);
        for (const a of pendientes) await this.anclarUno(a);
      } while (this.repetir);
    } finally {
      this.enCurso = false;
    }
  }

  private async anclarUno(a: Pendiente) {
    try {
      const solicitud = await solicitudDeAnalisis(this.db, a);
      if (this.anclaje.firmaConWallet && !a.firma_servidor) {
        // Espera la firma del laboratorio: solo se comprueba si ya está en la red.
        const encontrado = await this.anclaje.buscarAnclaje(solicitud);
        if (encontrado) await marcarAnclado(this.db, a.id, encontrado);
        else {
          await this.db.query(`UPDATE analisis SET proximo_intento = now() + ($2 || ' milliseconds')::interval WHERE id = $1`, [
            a.id,
            String(RECONCILIAR_MS),
          ]);
        }
        return;
      }
      await marcarAnclado(this.db, a.id, await this.anclaje.anclar(solicitud));
    } catch (error) {
      const esperaMs = Math.min(ESPERA_MAX_MS, 2000 * 2 ** a.intentos_anclaje);
      // Los errores de simulación traen el registro de eventos completo: basta la primera línea.
      const mensaje = (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 500);
      console.warn(`[anclaje] análisis ${a.id}: ${mensaje}. Reintento en ${Math.round(esperaMs / 1000)} s`);
      await this.db.query(
        `UPDATE analisis SET intentos_anclaje = intentos_anclaje + 1, ultimo_error = $2,
           proximo_intento = now() + ($3 || ' milliseconds')::interval
         WHERE id = $1`,
        [a.id, mensaje, String(esperaMs)],
      );
    }
  }
}
