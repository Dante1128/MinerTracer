import type { RequestHandler } from 'express';

/** Límite local por IP; no confía en cabeceras de proxy enviadas por el cliente. */
export function limitarAcceso(): RequestHandler {
  const intentos = new Map<string, { cantidad: number; vence: number }>();
  return (req, res, next) => {
    const ahora = Date.now();
    for (const [clave, intento] of intentos) {
      if (intento.vence <= ahora) intentos.delete(clave);
    }
    const clave = req.ip ?? 'desconocida';
    const intento = intentos.get(clave) ?? { cantidad: 0, vence: ahora + 15 * 60_000 };
    if (intento.cantidad >= 20 || (!intentos.has(clave) && intentos.size >= 10_000)) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((intento.vence - ahora) / 1000))));
      res.status(429).json({ error: 'Demasiados intentos. Espere unos minutos antes de volver a ingresar.' });
      return;
    }
    intento.cantidad++;
    intentos.set(clave, intento);
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
