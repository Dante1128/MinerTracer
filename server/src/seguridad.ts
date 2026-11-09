import type { RequestHandler } from 'express';
import { createHmac } from 'node:crypto';
import { config } from './config.ts';
import type { Db } from './db/index.ts';

/** Contadores atómicos compartidos por todas las instancias que usan la misma base. */
export function limitarAcceso(db: Db, ambito: string, maximo = 20): RequestHandler {
  return async (req, res, next) => {
    await db.query('DELETE FROM limites_acceso WHERE clave IN (SELECT clave FROM limites_acceso WHERE vence <= now() LIMIT 100)');
    const identidades = [`ip:${req.ip ?? 'desconocida'}`];
    if (typeof req.body?.email === 'string') identidades.push(`cuenta:${req.body.email.trim().toLowerCase().slice(0, 254)}`);
    for (const identidad of identidades) {
      const clave = createHmac('sha256', config.jwtSecret).update(`${ambito}:${identidad}`).digest('hex');
      const [intento] = await db.query<{ cantidad: number; espera: number }>(
        `INSERT INTO limites_acceso (clave, cantidad, vence) VALUES ($1, 1, now() + interval '15 minutes')
         ON CONFLICT (clave) DO UPDATE SET
           cantidad = CASE WHEN limites_acceso.vence <= now() THEN 1 ELSE LEAST(limites_acceso.cantidad + 1, $2 + 1) END,
           vence = CASE WHEN limites_acceso.vence <= now() THEN now() + interval '15 minutes' ELSE limites_acceso.vence END
         RETURNING cantidad, CEIL(EXTRACT(EPOCH FROM (vence - now())))::int AS espera`, [clave, maximo],
      );
      if (intento.cantidad > maximo) {
        res.setHeader('Retry-After', String(Math.max(1, intento.espera)));
        res.status(429).json({ error: 'Demasiados intentos. Espere unos minutos antes de volver a ingresar.' });
        return;
      }
    }
    next();
  };
}

export const cabecerasSeguras: RequestHandler = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; worker-src 'self' blob:");
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
};
