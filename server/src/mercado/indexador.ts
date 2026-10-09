import { rpc, scValToNative, type xdr } from '@stellar/stellar-sdk';
import type { Db } from '../db/index.ts';
import type { ContratoSoroban } from '../stellar/contrato.ts';

const POR_PAGINA = 200;

/** Valores del contrato → JSON: bigint como texto, bytes como hexadecimal. */
export function aJson(valor: unknown): unknown {
  if (typeof valor === 'bigint') return valor.toString();
  if (valor instanceof Uint8Array) return Buffer.from(valor).toString('hex');
  if (Array.isArray(valor)) return valor.map(aJson);
  if (valor && typeof valor === 'object') {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, aJson(v)]));
  }
  return valor;
}

/** El cursor de getEvents empieza con un TOID: el número de ledger va en los 32 bits altos. */
export function ledgerDelCursor(cursor: string): number {
  return Number(BigInt(cursor.split('-')[0]) >> 32n);
}

/** Convierte un evento del contrato en una fila: tipo, lote y datos (con los temas incluidos). */
export function filaDeEvento(evento: { topic: xdr.ScVal[]; value: xdr.ScVal }) {
  const temas = evento.topic.map((t) => aJson(scValToNative(t)));
  const tipo = String(temas[0]);
  const datos = { ...(aJson(scValToNative(evento.value)) as Record<string, unknown>) };
  let loteId: string | null = null;
  if (tipo.startsWith('laboratorio_')) {
    datos.lab = temas[1];
  } else if (tipo !== 'configurado') {
    loteId = String(temas[1]);
    if (tipo === 'analisis_registrado') datos.analisis_id = temas[2];
  }
  return { tipo, loteId, datos };
}

/**
 * Copia en la base de datos los eventos del contrato, para mostrar la línea
 * de tiempo de cada lote aunque el RPC ya no los conserve. Lee desde el ledger
 * más antiguo disponible la primera vez y luego continúa desde su cursor.
 */
export class IndexadorEventos {
  private db: Db;
  private contrato: ContratoSoroban;
  private enCurso: Promise<void> | null = null;
  private temporizador: NodeJS.Timeout | null = null;

  constructor(db: Db, contrato: ContratoSoroban) {
    this.db = db;
    this.contrato = contrato;
  }

  iniciar(intervaloMs = 15_000) {
    this.temporizador = setInterval(() => void this.sincronizar().catch(() => {}), intervaloMs);
    void this.sincronizar().catch(() => {});
  }

  detener() {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  /** Trae los eventos nuevos. Si ya hay una sincronización en curso, espera esa misma. */
  sincronizar(): Promise<void> {
    this.enCurso ??= this.leerEventos()
      .catch((error) => {
        console.warn(`[eventos] ${(error as Error).message.split('\n')[0]}`);
        throw error;
      })
      .finally(() => {
        this.enCurso = null;
      });
    return this.enCurso;
  }

  private async leerEventos() {
    const filtros: rpc.Api.EventFilter[] = [{ type: 'contract', contractIds: [this.contrato.contratoId] }];
    const [estado] = await this.db.query<{ cursor: string | null }>(
      'SELECT cursor FROM indice_eventos WHERE contrato_id = $1',
      [this.contrato.contratoId],
    );
    let solicitud: rpc.Api.GetEventsRequest;
    if (estado?.cursor) {
      solicitud = { filters: filtros, cursor: estado.cursor, limit: POR_PAGINA };
    } else {
      const salud = await this.contrato.servidor.getHealth();
      solicitud = { filters: filtros, startLedger: salud.oldestLedger + 1, limit: POR_PAGINA };
    }

    for (;;) {
      let respuesta: rpc.Api.GetEventsResponse;
      try {
        respuesta = await this.contrato.servidor.getEvents(solicitud);
      } catch (error) {
        // El cursor quedó fuera de la ventana de retención: se recomienza desde lo más antiguo disponible.
        if ('cursor' in solicitud && solicitud.cursor) {
          await this.guardarCursor(null);
          const salud = await this.contrato.servidor.getHealth();
          solicitud = { filters: filtros, startLedger: salud.oldestLedger + 1, limit: POR_PAGINA };
          continue;
        }
        throw error;
      }
      for (const evento of respuesta.events) {
        const { tipo, loteId, datos } = filaDeEvento(evento);
        await this.db.query(
          `INSERT INTO eventos_contrato (contrato_id, id, tipo, lote_id, datos, ledger, fecha, tx_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
          [
            this.contrato.contratoId,
            evento.id,
            tipo,
            loteId,
            JSON.stringify(datos),
            evento.ledger,
            new Date(evento.ledgerClosedAt).toISOString().replace(/\.\d{3}Z$/, 'Z'),
            evento.txHash,
          ],
        );
      }
      await this.guardarCursor(respuesta.cursor);
      // El RPC recorre una ventana limitada de ledgers por consulta: se sigue
      // hasta que el cursor alcanza el último ledger, aunque la página venga vacía.
      if (respuesta.events.length < POR_PAGINA && ledgerDelCursor(respuesta.cursor) >= respuesta.latestLedger) return;
      solicitud = { filters: filtros, cursor: respuesta.cursor, limit: POR_PAGINA };
    }
  }

  private async guardarCursor(cursor: string | null) {
    await this.db.query(
      `INSERT INTO indice_eventos (contrato_id, cursor) VALUES ($1, $2)
       ON CONFLICT (contrato_id) DO UPDATE SET cursor = EXCLUDED.cursor`,
      [this.contrato.contratoId, cursor],
    );
  }
}
