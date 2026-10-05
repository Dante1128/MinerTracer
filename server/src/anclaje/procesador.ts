import type { Db } from '../db/index.ts';
import type { ServicioAnclaje } from './ServicioAnclaje.ts';

const ESPERA_MAX_MS = 5 * 60 * 1000;
/** Mientras dura la reserva, ningún otro procesador toma el análisis. Debe superar lo que tarda un anclaje. */
const RESERVA_MS = 5 * 60 * 1000;

type Pendiente = { id: number; hash: string; laboratorio_id: string; intentos_anclaje: number };

/**
 * Ancla los análisis en estado `pendiente` y reintenta con espera exponencial
 * si la red falla. El análisis ya está en la base de datos, así que nunca se
 * pierde.
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
           RETURNING id, hash, laboratorio_id, intentos_anclaje`,
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
      const { txId, fecha } = await this.anclaje.anclar(a.hash, a.laboratorio_id);
      await this.db.query(
        `UPDATE analisis SET estado_anclaje = 'anclado', tx_id = $2, fecha_anclaje = $3,
           intentos_anclaje = intentos_anclaje + 1, ultimo_error = NULL, proximo_intento = NULL
         WHERE id = $1`,
        [a.id, txId, fecha],
      );
    } catch (error) {
      const esperaMs = Math.min(ESPERA_MAX_MS, 2000 * 2 ** a.intentos_anclaje);
      const mensaje = error instanceof Error ? error.message : String(error);
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
