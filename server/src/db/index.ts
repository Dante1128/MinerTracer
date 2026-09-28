import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { config } from '../config.ts';
import { ESQUEMA } from './esquema.ts';

/**
 * Acceso mínimo a PostgreSQL. Funciona igual con un servidor real (pg) o con
 * PGlite embebido, para poder desarrollar sin instalar ni configurar nada.
 */
export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  cerrar(): Promise<void>;
  motor: 'postgres' | 'pglite';
}

// pg devuelve BIGINT/NUMERIC como texto; COUNT(*) queda como número en ambos motores.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));

function desdePg(url: string): Db {
  const pool = new pg.Pool({ connectionString: url });
  return {
    motor: 'postgres',
    async query(sql, params) {
      return (await pool.query(sql, params as unknown[])).rows;
    },
    async exec(sql) {
      await pool.query(sql);
    },
    cerrar: () => pool.end(),
  };
}

async function desdePglite(dir: string | null): Promise<Db> {
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const lite = await PGlite.create(dir ?? undefined);
  return {
    motor: 'pglite',
    async query(sql, params) {
      return (await lite.query<any>(sql, params as unknown[])).rows;
    },
    async exec(sql) {
      await lite.exec(sql);
    },
    cerrar: () => lite.close(),
  };
}

/** `memoria: true` crea una base temporal (usada en pruebas). */
export async function conectar(opciones: { memoria?: boolean } = {}): Promise<Db> {
  const db = opciones.memoria
    ? await desdePglite(null)
    : config.databaseUrl
      ? desdePg(config.databaseUrl)
      : await desdePglite(path.join(config.datosDir, 'pglite'));
  await db.exec(ESQUEMA);
  return db;
}
