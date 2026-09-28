import type { Db } from '../db/index.ts';
import type { ServicioAnclaje } from './ServicioAnclaje.ts';

const ESPERA_MAX_MS = 5 * 60 * 1000;

/**
 * Ancla los análisis en estado `pendiente` y reintenta con espera exponencial
 * si la red falla. El análisis ya está en la base de datos, así que nunca se
 * pierde. En Fase 2 puede sustituirse por una cola (Redis + BullMQ).
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
        const pendientes = await this.db.query<{ id: number; hash: string; laboratorio_id: string; intentos_anclaje: number }>(
          `SELECT id, hash, laboratorio_id, intentos_anclaje FROM analisis
           WHERE estado_anclaje = 'pendiente' AND (proximo_intento IS NULL OR proximo_intento <= now())
           ORDER BY id LIMIT 50`,
        );
        for (const a of pendientes) await this.anclarUno(a);
      } while (this.repetir);
    } finally {
      this.enCurso = false;
    }
  }

  private async anclarUno(a: { id: number; hash: string; laboratorio_id: string; intentos_anclaje: number }) {
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
