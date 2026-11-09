import bcrypt from 'bcryptjs';
import { Router, type Request } from 'express';
import { cerrarSesion, crearSesion, hashSecreto, requiereSesion, secretoAleatorio, usuarioDe } from '../auth.ts';
import { ErrorHttp, type Contexto, type Usuario } from '../contexto.ts';
import { limitarAcceso } from '../seguridad.ts';
import { CAMPOS_USUARIO, conSupervisor, emailNormalizado, emitirRecuperacion, revocarAcceso, validarClave, validarUsuario } from '../servicios/cuentas.ts';

const hashInexistente = await bcrypt.hash(secretoAleatorio(), 12);
const publico = (fila: Usuario) => ({ id: fila.id, email: fila.email, nombre: fila.nombre, rol: fila.rol, laboratorio_id: fila.laboratorio_id });
const idDe = (req: Request) => {
  const texto = String(req.params.id ?? '');
  const id = Number(texto);
  if (!/^[1-9]\d*$/.test(texto) || !Number.isSafeInteger(id)) throw new ErrorHttp(400, 'Usuario inválido');
  return id;
};

export function rutasCuentas(ctx: Contexto) {
  const r = Router();
  const sesion = requiereSesion(ctx.db);

  r.post('/auth/login', limitarAcceso(ctx.db, 'login'), async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
      throw new ErrorHttp(401, 'Correo o contraseña incorrectos');
    }
    const [fila] = await ctx.db.query('SELECT * FROM usuarios WHERE email = $1', [emailNormalizado(email)]);
    const correcta = await bcrypt.compare(password, fila?.password_hash ?? hashInexistente);
    if (!fila?.activo || !correcta) throw new ErrorHttp(401, 'Correo o contraseña incorrectos');
    const csrf = await crearSesion(ctx.db, fila, req, res);
    res.json({ usuario: publico(fila), csrf });
  });

  r.post('/auth/salir', async (req, res) => res.json({ csrf: await cerrarSesion(ctx.db, req, res) }));

  r.post('/auth/recuperar', limitarAcceso(ctx.db, 'recuperar', 5), async (req, res) => {
    const email = emailNormalizado(req.body?.email).slice(0, 254);
    await ctx.db.transaccion(async (conexion) => {
      const [usuario] = await conexion.query('SELECT * FROM usuarios WHERE email = $1 AND activo FOR UPDATE', [email]);
      if (usuario) await emitirRecuperacion(conexion, usuario);
    });
    res.status(202).json({ mensaje: 'Si la cuenta está habilitada, recibirá un enlace para establecer su contraseña.' });
  });

  r.post('/auth/restablecer', limitarAcceso(ctx.db, 'restablecer'), async (req, res) => {
    const secreto = req.body?.secreto;
    if (typeof secreto !== 'string' || !/^[a-f0-9]{64}$/.test(secreto)) throw new ErrorHttp(400, 'El enlace no es válido o ya venció');
    const hash = await bcrypt.hash(validarClave(req.body?.password), 12);
    await ctx.db.transaccion(async (conexion) => {
      const [usuario] = await conexion.query(
        `SELECT u.* FROM usuarios u JOIN recuperaciones r ON r.usuario_id = u.id
         WHERE r.hash = $1 AND r.vence > now() AND u.activo FOR UPDATE OF u`, [hashSecreto(secreto)],
      );
      if (!usuario) throw new ErrorHttp(400, 'El enlace no es válido o ya venció');
      const [consumido] = await conexion.query(
        'DELETE FROM recuperaciones WHERE hash = $1 AND vence > now() AND revision_acceso = $2 RETURNING usuario_id',
        [hashSecreto(secreto), usuario.revision_acceso],
      );
      if (!consumido) throw new ErrorHttp(400, 'El enlace no es válido o ya venció');
      await conexion.query('UPDATE usuarios SET password_hash = $2 WHERE id = $1', [usuario.id, hash]);
      await revocarAcceso(conexion, usuario.id);
    });
    res.json({ mensaje: 'Contraseña actualizada. Inicie sesión con su nueva contraseña.', csrf: await cerrarSesion(ctx.db, req, res) });
  });

  r.post('/auth/clave', sesion, limitarAcceso(ctx.db, 'cambiar-clave', 10), async (req, res) => {
    const usuario = usuarioDe(req);
    const nueva = validarClave(req.body?.password);
    const actual = req.body?.actual;
    if (typeof actual !== 'string' || Buffer.byteLength(actual, 'utf8') > 72) throw new ErrorHttp(400, 'Ingrese su contraseña actual');
    const hash = await bcrypt.hash(nueva, 12);
    await ctx.db.transaccion(async (conexion) => {
      const [fila] = await conexion.query('SELECT * FROM usuarios WHERE id = $1 AND activo FOR UPDATE', [usuario.id]);
      if (!fila || !await bcrypt.compare(actual, fila.password_hash)) throw new ErrorHttp(400, 'La contraseña actual no es correcta');
      await conexion.query('UPDATE usuarios SET password_hash = $2 WHERE id = $1', [usuario.id, hash]);
      await revocarAcceso(conexion, usuario.id);
    });
    res.json({ mensaje: 'Contraseña actualizada. Inicie sesión de nuevo.', csrf: await cerrarSesion(ctx.db, req, res) });
  });

  r.post('/auth/sesiones/revocar', sesion, async (req, res) => {
    await ctx.db.transaccion(async (conexion) => { await revocarAcceso(conexion, usuarioDe(req).id); });
    res.json({ csrf: await cerrarSesion(ctx.db, req, res) });
  });

  r.use('/usuarios', sesion, (req, _res, next) => {
    if (usuarioDe(req).rol !== 'supervisor') throw new ErrorHttp(403, 'Solo los supervisores pueden administrar usuarios');
    next();
  });

  r.get('/usuarios', async (req, res) => {
    res.json(await ctx.db.query(`SELECT ${CAMPOS_USUARIO} FROM usuarios WHERE laboratorio_id = $1 ORDER BY nombre, id`, [usuarioDe(req).laboratorio_id]));
  });

  r.post('/usuarios', limitarAcceso(ctx.db, 'crear-usuario'), async (req, res) => {
    const datos = validarUsuario(req.body ?? {});
    const actor = usuarioDe(req);
    // La contraseña inicial es aleatoria e inaccesible: el destinatario elige la suya por correo.
    const hash = await bcrypt.hash(secretoAleatorio(), 12);
    const usuario = await conSupervisor(ctx.db, actor, async (conexion) => {
      const [fila] = await conexion.query(
        `INSERT INTO usuarios (email, nombre, rol, laboratorio_id, password_hash) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO NOTHING RETURNING ${CAMPOS_USUARIO}, revision_acceso`,
        [datos.email, datos.nombre, datos.rol, actor.laboratorio_id, hash],
      );
      if (!fila) throw new ErrorHttp(409, 'No se puede crear una cuenta con ese correo');
      await emitirRecuperacion(conexion, fila);
      return fila;
    });
    res.status(201).json({ ...publico(usuario), activo: usuario.activo });
  });

  r.post('/usuarios/:id/:accion', limitarAcceso(ctx.db, 'administrar-usuario'), async (req, res) => {
    const actor = usuarioDe(req);
    const id = idDe(req);
    const accion = req.params.accion;
    if (!['estado', 'rol', 'revocar', 'invitacion'].includes(String(accion))) throw new ErrorHttp(404, 'Acción no encontrada');
    if (id === actor.id) throw new ErrorHttp(400, 'Use Mi cuenta para gestionar su propio acceso');
    if (accion === 'estado' && typeof req.body?.activo !== 'boolean') throw new ErrorHttp(400, 'Indique si la cuenta está habilitada');
    if (accion === 'rol' && !['analista', 'supervisor'].includes(req.body?.rol)) throw new ErrorHttp(400, 'Seleccione un rol válido');
    await conSupervisor(ctx.db, actor, async (conexion) => {
      const [usuario] = await conexion.query('SELECT * FROM usuarios WHERE id = $1 AND laboratorio_id = $2 FOR UPDATE', [id, actor.laboratorio_id]);
      if (!usuario) throw new ErrorHttp(404, 'Usuario no encontrado');
      if (accion === 'invitacion') {
        if (!usuario.activo) throw new ErrorHttp(409, 'Habilite la cuenta antes de enviar un enlace');
        await emitirRecuperacion(conexion, usuario);
      } else {
        if (accion === 'estado') await conexion.query('UPDATE usuarios SET activo = $2 WHERE id = $1', [id, req.body.activo]);
        if (accion === 'rol') await conexion.query('UPDATE usuarios SET rol = $2 WHERE id = $1', [id, req.body.rol]);
        await revocarAcceso(conexion, id);
      }
    });
    res.json({ mensaje: accion === 'invitacion' ? 'Enlace solicitado. Se enviará por correo.' : 'Acceso actualizado.' });
  });

  return r;
}
