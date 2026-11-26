import { Router } from 'express';
import { requiereSesion } from '../auth.ts';
import * as cuentas from '../controladores/cuentas.ts';
import type { Contexto } from '../contexto.ts';
import { limitarAcceso } from '../seguridad.ts';
import { enlazar, type Controlador } from './enlazar.ts';

/** Rutas: autenticación y administración de cuentas (lógica en ../controladores/cuentas.ts). */
export function rutasCuentas(ctx: Contexto) {
  const r = Router();
  const sesion = requiereSesion(ctx.db);
  const con = (controlador: Controlador) => enlazar(ctx, controlador);

  r.post('/auth/login', limitarAcceso(ctx.db, 'login'), con(cuentas.login));
  r.post('/auth/salir', con(cuentas.salir));
  r.post('/auth/recuperar', limitarAcceso(ctx.db, 'recuperar', 5), con(cuentas.recuperar));
  r.post('/auth/restablecer', limitarAcceso(ctx.db, 'restablecer'), con(cuentas.restablecer));
  r.post('/auth/clave', sesion, limitarAcceso(ctx.db, 'cambiar-clave', 10), con(cuentas.cambiarClave));
  r.post('/auth/sesiones/revocar', sesion, con(cuentas.revocarSesiones));

  r.use('/usuarios', sesion, cuentas.exigirSupervisor);
  r.get('/usuarios', con(cuentas.listarUsuarios));
  r.post('/usuarios', limitarAcceso(ctx.db, 'crear-usuario'), con(cuentas.crearUsuario));
  r.post('/usuarios/:id/:accion', limitarAcceso(ctx.db, 'administrar-usuario'), con(cuentas.administrarUsuario));

  return r;
}
