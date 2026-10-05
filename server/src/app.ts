import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { config } from './config.ts';
import { ErrorContrato } from './anclaje/erroresContrato.ts';
import { ErrorHttp, type Contexto } from './contexto.ts';
import { rutasContraAnalisis } from './rutas/contraAnalisis.ts';
import { rutasDemo } from './rutas/demo.ts';
import { rutasLaboratorio } from './rutas/laboratorio.ts';
import { rutasMercado } from './rutas/mercado.ts';
import { rutasPublicas } from './rutas/publico.ts';
import { FondosInsuficientes, TransaccionRechazada } from './stellar/contrato.ts';
import { ErrorValidacion } from './validacion.ts';

export function crearApp(ctx: Contexto) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/publico', rutasPublicas(ctx));
  app.use('/api/mercado', rutasMercado(ctx));
  app.use('/api/contra-analisis', rutasContraAnalisis(ctx));
  if (config.demoAlterar) app.use('/api/demo', rutasDemo(ctx));
  app.use('/api', rutasLaboratorio(ctx));
  app.use('/api', (_req, _res) => {
    throw new ErrorHttp(404, 'Ruta no encontrada');
  });

  // En producción el mismo servidor entrega el frontend compilado (web/dist).
  const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(web)) {
    app.use(express.static(web, { index: false }));
    app.get('/{*ruta}', (_req, res) => res.sendFile(path.join(web, 'index.html')));
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ErrorValidacion) {
      res.status(400).json({ error: 'Revise los datos del formulario', errores: error.errores });
    } else if (error instanceof ErrorHttp) {
      res.status(error.estado).json({ error: error.message });
    } else if (error instanceof ErrorContrato) {
      // El contrato rechazó la operación (estado del lote, permisos...).
      res.status(409).json({ error: error.message, codigo_contrato: error.codigo });
    } else if (error instanceof FondosInsuficientes) {
      res.status(402).json({ error: error.message, fondos_insuficientes: true });
    } else if (error instanceof TransaccionRechazada) {
      res.status(422).json({ error: error.message });
    } else if (error instanceof multer.MulterError) {
      const mensaje = error.code === 'LIMIT_FILE_SIZE' ? 'El PDF supera el tamaño máximo (20 MB)' : error.message;
      res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: mensaje });
    } else if ((error as { type?: string })?.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'JSON inválido' });
    } else {
      console.error(error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  return app;
}
