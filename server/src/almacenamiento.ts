import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.ts';
import { sha256Hex } from './integridad/canonico.ts';

/**
 * Almacén de archivos direccionado por contenido: cada PDF se guarda con su
 * SHA-256 como nombre. En producción puede reemplazarse por S3 o MinIO.
 */
const dirPdfs = () => path.join(config.datosDir, 'pdfs');
const rutaPdf = (sha256: string) => path.join(dirPdfs(), `${sha256}.pdf`);

export function esPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

export async function guardarPdf(buffer: Buffer): Promise<string> {
  const sha256 = sha256Hex(buffer);
  await fs.mkdir(dirPdfs(), { recursive: true });
  try {
    await fs.writeFile(rutaPdf(sha256), buffer, { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return sha256;
}

export async function leerPdf(sha256: string): Promise<Buffer | null> {
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  try {
    return await fs.readFile(rutaPdf(sha256));
  } catch {
    return null;
  }
}

/** Solo para la demostración de fraude: sustituye el contenido del archivo sin cambiar su nombre. */
export async function sobrescribirPdf(sha256: string, buffer: Buffer): Promise<void> {
  await fs.writeFile(rutaPdf(sha256), buffer);
}
