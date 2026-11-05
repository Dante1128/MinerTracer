import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { config } from './config.ts';
import type { Consultas, Db } from './db/index.ts';

const clave = createHash('sha256').update(`correo:${config.jwtSecret}`).digest();
const transporte = nodemailer.createTransport({
  host: config.correo.host,
  port: config.correo.puerto,
  secure: config.correo.seguro,
  requireTLS: config.produccion && !config.correo.seguro,
  auth: config.correo.usuario ? { user: config.correo.usuario, pass: config.correo.clave } : undefined,
  connectionTimeout: 10_000,
  socketTimeout: 15_000,
  disableFileAccess: true,
  disableUrlAccess: true,
});

/** Los enlaces de acceso se guardan cifrados hasta entregarlos, nunca en los registros. */
export async function encolarAcceso(db: Consultas, usuarioId: number, destinatario: string, secreto: string) {
  const enlace = `${config.origenPublico}/laboratorio/recuperar#${secreto}`;
  const contenido = JSON.stringify({ asunto: 'Establezca su contraseña de MinerTrace',
    texto: `Para establecer su contraseña, abra este enlace:\n${enlace}\n\nVence en 30 minutos y solo puede usarse una vez. Si no solicitó este acceso, ignore el mensaje.` });
  const vector = randomBytes(12);
  const cifrador = createCipheriv('aes-256-gcm', clave, vector);
  const cifrado = Buffer.concat([cifrador.update(contenido, 'utf8'), cifrador.final()]);
  const paquete = Buffer.concat([vector, cifrador.getAuthTag(), cifrado]).toString('base64');
  await db.query('DELETE FROM correos_pendientes WHERE usuario_id = $1', [usuarioId]);
  await db.query("INSERT INTO correos_pendientes (destinatario, contenido_cifrado, usuario_id, vence) VALUES ($1, $2, $3, now() + interval '30 minutes')", [destinatario, paquete, usuarioId]);
}

type Envio = (destinatario: string, asunto: string, texto: string) => Promise<void>;
const enviarSmtp: Envio = async (destinatario, asunto, texto) => {
  if (!config.correo.host || !config.correo.remitente) throw new Error('SMTP no configurado');
  await transporte.sendMail({ from: config.correo.remitente, to: destinatario, subject: asunto, text: texto });
};

export class ProcesadorCorreos {
  private db: Db;
  private enviar: Envio;
  private ocupado = false;
  private temporizador: ReturnType<typeof setInterval> | null = null;

  constructor(db: Db, enviar: Envio = enviarSmtp) { this.db = db; this.enviar = enviar; }

  iniciar() {
    if (this.temporizador) return;
    const ejecutar = () => { void this.procesar().catch(() => console.error('[correo] No se pudo procesar la cola')); };
    ejecutar();
    this.temporizador = setInterval(ejecutar, 15_000);
  }

  detener() { if (this.temporizador) clearInterval(this.temporizador); this.temporizador = null; }

  async procesar() {
    if (this.ocupado) return;
    this.ocupado = true;
    try {
      await this.db.query('DELETE FROM correos_pendientes WHERE vence <= now()');
      for (let i = 0; i < 10; i++) {
        const [correo] = await this.db.query(
          `UPDATE correos_pendientes SET reservado_hasta = now() + interval '2 minutes', intentos = intentos + 1
           WHERE id IN (SELECT id FROM correos_pendientes WHERE reservado_hasta <= now() AND vence > now() AND intentos < 5
             ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
        );
        if (!correo) break;
        try {
          const paquete = Buffer.from(correo.contenido_cifrado, 'base64');
          const descifrador = createDecipheriv('aes-256-gcm', clave, paquete.subarray(0, 12));
          descifrador.setAuthTag(paquete.subarray(12, 28));
          const contenido = JSON.parse(Buffer.concat([descifrador.update(paquete.subarray(28)), descifrador.final()]).toString('utf8'));
          await this.enviar(correo.destinatario, contenido.asunto, contenido.texto);
          await this.db.query('DELETE FROM correos_pendientes WHERE id = $1', [correo.id]);
        } catch {
          console.error(`[correo] Entrega pendiente ${correo.id}, intento ${correo.intentos}/5`);
        }
      }
    } finally { this.ocupado = false; }
  }
}
