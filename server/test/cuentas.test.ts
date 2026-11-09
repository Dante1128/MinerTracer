import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'minertrace-cuentas-'));
process.env.DATOS_DIR = temporal;
process.env.ANCLAJE = 'mock';
process.env.DEMO_ALTERAR = 'true';
delete process.env.DATABASE_URL;

const { conectar } = await import('../src/db/index.ts');
const { crearApp } = await import('../src/app.ts');
const { AnclajeMock } = await import('../src/anclaje/AnclajeMock.ts');
const { ProcesadorAnclajes } = await import('../src/anclaje/procesador.ts');
const { ProcesadorCorreos } = await import('../src/correo.ts');
const { hashSecreto } = await import('../src/auth.ts');
const { config } = await import('../src/config.ts');
const { sembrar, PASSWORD_DEMO } = await import('../src/semilla.ts');
const db = await conectar({ memoria: true });
const anclaje = new AnclajeMock(db);
const procesador = new ProcesadorAnclajes(db, anclaje);
const enviados: { destinatario: string; texto: string }[] = [];
const correos = new ProcesadorCorreos(db, async (destinatario, _asunto, texto) => { enviados.push({ destinatario, texto }); });
let servidores: Server[] = [];
let bases: string[] = [];

class Cliente {
  cookies = new Map<string, string>();
  base: string;
  constructor(base = bases[0]) { this.base = base; }
  get cabeceraCookie() { return [...this.cookies].map(([nombre, valor]) => `${nombre}=${valor}`).join('; '); }
  async solicitar(ruta: string, json?: unknown, opciones: { sinCsrf?: boolean; cabeceras?: Record<string, string> } = {}): Promise<{ respuesta: Response; cuerpo: any }> {
    const cabeceras: Record<string, string> = {};
    if (json !== undefined && !opciones.sinCsrf) {
      const preparacion = await this.solicitar('/auth/csrf');
      cabeceras['X-CSRF-Token'] = preparacion.cuerpo.csrf;
    }
    cabeceras.cookie = this.cabeceraCookie;
    if (json !== undefined) cabeceras['content-type'] = 'application/json';
    const respuesta = await fetch(`${this.base}/api${ruta}`, {
      method: json === undefined ? 'GET' : 'POST',
      headers: { ...cabeceras, ...opciones.cabeceras },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    for (const valor of respuesta.headers.getSetCookie()) {
      const par = valor.split(';')[0];
      const separador = par.indexOf('=');
      this.cookies.set(par.slice(0, separador), par.slice(separador + 1));
    }
    return { respuesta, cuerpo: await respuesta.json() };
  }
  async entrar(email: string, password = PASSWORD_DEMO) {
    return this.solicitar('/auth/login', { email, password });
  }
  copiar(base = this.base) { const copia = new Cliente(base); copia.cookies = new Map(this.cookies); return copia; }
}

const supervisor = async (otro = false) => {
  const cliente = new Cliente();
  assert.equal((await cliente.entrar(`supervisor@lab00${otro ? 2 : 1}.test`)).respuesta.status, 200);
  return cliente;
};

const crear = async (email: string, rol = 'analista') => {
  const administrador = await supervisor();
  const resultado = await administrador.solicitar('/usuarios', { email, nombre: 'Persona de prueba', rol });
  assert.equal(resultado.respuesta.status, 201, JSON.stringify(resultado.cuerpo));
  return { administrador, usuario: resultado.cuerpo };
};

const secretoEntregado = async (email: string) => {
  await correos.procesar();
  const correo = enviados.filter((mensaje) => mensaje.destinatario === email).at(-1);
  assert.ok(correo);
  const secreto = correo.texto.match(/#([a-f0-9]{64})/)?.[1];
  assert.ok(secreto);
  assert.ok(correo.texto.includes(`${config.origenPublico}/laboratorio/recuperar#`));
  return secreto;
};

before(async () => {
  await sembrar({ db, anclaje, procesador }, { lotesDemo: false });
  servidores = [crearApp({ db, anclaje, procesador }).listen(0), crearApp({ db, anclaje, procesador }).listen(0)];
  bases = servidores.map((servidor) => `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`);
});
beforeEach(async () => { await db.query('DELETE FROM limites_acceso'); });
after(async () => {
  for (const servidor of servidores) servidor.close();
  procesador.detener();
  await db.cerrar();
  fs.rmSync(temporal, { recursive: true, force: true });
});

test('la cookie HttpOnly reemplaza el bearer, rota al ingresar y se revoca al salir en ambas instancias', async () => {
  const cliente = new Cliente();
  const ingreso = await cliente.entrar('analista@lab001.test');
  assert.equal(ingreso.respuesta.status, 200);
  assert.equal(ingreso.cuerpo.token, undefined);
  const cookie = ingreso.respuesta.headers.getSetCookie().find((valor) => valor.startsWith('minertrace.sesion='));
  assert.match(cookie ?? '', /HttpOnly/i);
  assert.match(cookie ?? '', /SameSite=Strict/i);
  const secreto = cliente.cookies.get('minertrace.sesion')!;
  const [sesion] = await db.query('SELECT * FROM sesiones WHERE hash = $1', [hashSecreto(secreto)]);
  assert.ok(sesion);
  assert.notEqual(sesion.hash, secreto);
  const bearer = await fetch(`${bases[0]}/api/auth/yo`, { headers: { authorization: `Bearer ${secreto}` } });
  assert.equal(bearer.status, 401);
  const anterior = cliente.copiar();
  await cliente.entrar('analista@lab001.test');
  assert.equal((await anterior.solicitar('/auth/yo')).respuesta.status, 401);
  assert.equal((await cliente.copiar(bases[1]).solicitar('/auth/yo')).respuesta.status, 200);
  const robada = cliente.copiar(bases[1]);
  assert.equal((await cliente.solicitar('/auth/salir', {})).respuesta.status, 200);
  assert.equal((await robada.solicitar('/auth/yo')).respuesta.status, 401);
});

test('CSRF protege login y escrituras, rechaza otro origen y queda vinculado a la sesión', async () => {
  const cliente = new Cliente();
  assert.equal((await cliente.solicitar('/auth/login', { email: 'analista@lab001.test', password: PASSWORD_DEMO }, { sinCsrf: true })).respuesta.status, 403);
  const preparacion = await cliente.solicitar('/auth/csrf');
  const anonimo = preparacion.cuerpo.csrf;
  assert.equal((await cliente.solicitar('/auth/login', { email: 'analista@lab001.test', password: PASSWORD_DEMO }, { cabeceras: { Origin: 'https://otro.test' } })).respuesta.status, 403);
  await cliente.entrar('analista@lab001.test');
  assert.equal((await cliente.solicitar('/lotes', {}, { sinCsrf: true, cabeceras: { 'X-CSRF-Token': anonimo } })).respuesta.status, 403);
  assert.equal((await cliente.solicitar('/auth/salir', {}, { cabeceras: { 'Sec-Fetch-Site': 'cross-site' } })).respuesta.status, 403);
  assert.equal((await cliente.solicitar('/auth/yo')).respuesta.status, 200, 'un rechazo CSRF no cambia la sesión');
});

test('los supervisores solo administran su laboratorio y las altas no revelan contraseñas', async () => {
  const { administrador, usuario } = await crear('equipo@real.test');
  assert.equal(usuario.laboratorio_id, 'LAB-001');
  assert.equal(usuario.activo, true);
  assert.equal(usuario.password_hash, undefined);
  const listado = await administrador.solicitar('/usuarios');
  assert.ok(listado.cuerpo.every((fila: any) => fila.laboratorio_id === 'LAB-001' && !fila.password_hash));
  const otro = await supervisor(true);
  assert.equal((await otro.solicitar(`/usuarios/${usuario.id}/estado`, { activo: false })).respuesta.status, 404);
  const analista = new Cliente(); await analista.entrar('analista@lab001.test');
  assert.equal((await analista.solicitar('/usuarios')).respuesta.status, 403);
  assert.equal((await analista.solicitar('/usuarios', { email: 'ilegal@real.test', nombre: 'X', rol: 'supervisor' })).respuesta.status, 403);
  assert.equal((await administrador.solicitar('/usuarios', { email: 'equipo@real.test', nombre: 'X', rol: 'analista' })).respuesta.status, 409);
  assert.equal((await administrador.solicitar('/usuarios', { email: 'otro@real.test', nombre: 'X', rol: 'admin' })).respuesta.status, 400);
  const yo = (await administrador.solicitar('/auth/yo')).cuerpo.usuario;
  assert.equal((await administrador.solicitar(`/usuarios/${yo.id}/estado`, { activo: false })).respuesta.status, 400);
});

test('la invitación llega por correo, vence, se guarda cifrada y solo se puede consumir una vez incluso en paralelo', async () => {
  const email = 'invitacion@real.test';
  const { usuario } = await crear(email);
  const [pendiente] = await db.query('SELECT * FROM correos_pendientes WHERE usuario_id = $1', [usuario.id]);
  assert.ok(pendiente);
  assert.ok(!pendiente.contenido_cifrado.includes('/recuperar#'));
  const secreto = await secretoEntregado(email);
  const [recuperacion] = await db.query('SELECT * FROM recuperaciones WHERE usuario_id = $1', [usuario.id]);
  assert.equal(recuperacion.hash, hashSecreto(secreto));
  assert.ok(new Date(recuperacion.vence).getTime() <= Date.now() + 30 * 60_000);
  const clave = 'una frase segura de prueba';
  const respuestas = await Promise.all([new Cliente().solicitar('/auth/restablecer', { secreto, password: clave }), new Cliente(bases[1]).solicitar('/auth/restablecer', { secreto, password: clave })]);
  assert.deepEqual(respuestas.map((r) => r.respuesta.status).sort(), [200, 400]);
  assert.equal((await new Cliente().entrar(email, clave)).respuesta.status, 200);
  assert.equal((await new Cliente().solicitar('/auth/restablecer', { secreto, password: clave })).respuesta.status, 400);
});

test('recuperación responde igual para correos inexistentes y revoca todas las sesiones al cambiar la clave', async () => {
  const email = 'recuperacion@real.test';
  const { usuario } = await crear(email);
  const cliente = new Cliente();
  await cliente.solicitar('/auth/restablecer', { secreto: await secretoEntregado(email), password: 'clave inicial segura' });
  await cliente.entrar(email, 'clave inicial segura');
  const segunda = new Cliente(bases[1]); await segunda.entrar(email, 'clave inicial segura');
  const anonimo = new Cliente();
  const conocida = await anonimo.solicitar('/auth/recuperar', { email });
  const desconocida = await anonimo.solicitar('/auth/recuperar', { email: 'no-existe@real.test' });
  assert.equal(conocida.respuesta.status, 202);
  assert.deepEqual(conocida.cuerpo, desconocida.cuerpo);
  assert.equal((await cliente.solicitar('/auth/yo')).respuesta.status, 200, 'solicitar el enlace no cierra la sesión');
  const secreto = await secretoEntregado(email);
  assert.equal((await anonimo.solicitar('/auth/restablecer', { secreto, password: 'nueva frase segura' })).respuesta.status, 200);
  assert.equal((await cliente.solicitar('/auth/yo')).respuesta.status, 401);
  assert.equal((await segunda.solicitar('/auth/yo')).respuesta.status, 401);
  assert.equal((await anonimo.entrar(email, 'clave inicial segura')).respuesta.status, 401);
  assert.equal((await anonimo.entrar(email, 'nueva frase segura')).respuesta.status, 200);
  assert.equal((await db.query('SELECT * FROM sesiones WHERE usuario_id = $1', [usuario.id])).length, 1);
});

test('deshabilitar y revocar bloquea también contraanálisis, invalida enlaces y conserva al autor', async () => {
  const email = 'deshabilitado@real.test';
  const { administrador, usuario } = await crear(email);
  const cliente = new Cliente();
  await cliente.solicitar('/auth/restablecer', { secreto: await secretoEntregado(email), password: 'acceso de prueba seguro' });
  await cliente.entrar(email, 'acceso de prueba seguro');
  await new Cliente().solicitar('/auth/recuperar', { email });
  const enlace = await secretoEntregado(email);
  assert.equal((await administrador.solicitar(`/usuarios/${usuario.id}/estado`, { activo: false })).respuesta.status, 200);
  assert.equal((await cliente.solicitar('/auth/yo')).respuesta.status, 401);
  assert.equal((await cliente.solicitar('/contra-analisis/pendientes')).respuesta.status, 401);
  assert.equal((await new Cliente().solicitar('/auth/restablecer', { secreto: enlace, password: 'otra clave segura' })).respuesta.status, 400);
  assert.equal((await new Cliente().entrar(email, 'acceso de prueba seguro')).respuesta.status, 401);
  assert.equal((await db.query('SELECT id FROM usuarios WHERE id = $1', [usuario.id])).length, 1);
  await administrador.solicitar(`/usuarios/${usuario.id}/estado`, { activo: true });
  assert.equal((await cliente.solicitar('/auth/yo')).respuesta.status, 401, 'habilitar no resucita sesiones');
  await cliente.entrar(email, 'acceso de prueba seguro');
  await administrador.solicitar(`/usuarios/${usuario.id}/revocar`, {});
  assert.equal((await cliente.solicitar('/auth/yo')).respuesta.status, 401);
});

test('cambiar permisos revoca las sesiones y los dos supervisores no pueden deshabilitarse mutuamente en paralelo', async () => {
  const { administrador, usuario } = await crear('segundo-supervisor@real.test', 'supervisor');
  const segundo = new Cliente(bases[1]);
  await segundo.solicitar('/auth/restablecer', { secreto: await secretoEntregado(usuario.email), password: 'supervisor seguro nuevo' });
  await segundo.entrar(usuario.email, 'supervisor seguro nuevo');
  const principal = (await administrador.solicitar('/auth/yo')).cuerpo.usuario;
  const resultados = await Promise.all([
    administrador.solicitar(`/usuarios/${usuario.id}/estado`, { activo: false }),
    segundo.solicitar(`/usuarios/${principal.id}/estado`, { activo: false }),
  ]);
  assert.equal(resultados.filter((r) => r.respuesta.status === 200).length, 1);
  assert.ok(resultados.some((r) => [401, 403].includes(r.respuesta.status)));
  assert.ok((await db.query("SELECT id FROM usuarios WHERE laboratorio_id = 'LAB-001' AND activo AND rol = 'supervisor'")).length >= 1);
  // Restaura la cuenta semilla para que las pruebas siguientes sean independientes.
  await db.query('UPDATE usuarios SET activo = true WHERE id = $1', [principal.id]);
  const admin = await supervisor();
  await admin.solicitar(`/usuarios/${usuario.id}/estado`, { activo: true });
  await segundo.entrar(usuario.email, 'supervisor seguro nuevo');
  await admin.solicitar(`/usuarios/${usuario.id}/rol`, { rol: 'analista' });
  assert.equal((await segundo.solicitar('/usuarios')).respuesta.status, 401);
  await segundo.entrar(usuario.email, 'supervisor seguro nuevo');
  assert.equal((await segundo.solicitar('/usuarios')).respuesta.status, 403);
});

test('el cambio de contraseña exige la actual, valida el límite de bcrypt y cierra todos los dispositivos', async () => {
  const { usuario } = await crear('mi-cuenta@real.test');
  const cliente = new Cliente();
  await cliente.solicitar('/auth/restablecer', { secreto: await secretoEntregado(usuario.email), password: 'clave de inicio segura' });
  await cliente.entrar(usuario.email, 'clave de inicio segura');
  const otra = new Cliente(bases[1]); await otra.entrar(usuario.email, 'clave de inicio segura');
  assert.equal((await cliente.solicitar('/auth/clave', { actual: 'incorrecta', password: 'clave nueva segura' })).respuesta.status, 400);
  assert.equal((await cliente.solicitar('/auth/clave', { actual: 'clave de inicio segura', password: 'corta' })).respuesta.status, 400);
  assert.equal((await cliente.solicitar('/auth/clave', { actual: 'clave de inicio segura', password: 'á'.repeat(37) })).respuesta.status, 400);
  assert.equal((await cliente.solicitar('/auth/clave', { actual: 'clave de inicio segura', password: 'clave nueva segura' })).respuesta.status, 200);
  assert.equal((await otra.solicitar('/auth/yo')).respuesta.status, 401);
  assert.equal((await cliente.solicitar('/auth/yo')).respuesta.status, 401);
  await cliente.entrar(usuario.email, 'clave nueva segura');
  const copia = cliente.copiar(bases[1]);
  await cliente.solicitar('/auth/sesiones/revocar', {});
  assert.equal((await copia.solicitar('/auth/yo')).respuesta.status, 401);
});

test('los enlaces vencidos y las sesiones vencidas se rechazan, y reenviar invalida el enlace anterior', async () => {
  const { usuario, administrador } = await crear('vencimiento@real.test');
  const anterior = await secretoEntregado(usuario.email);
  await administrador.solicitar(`/usuarios/${usuario.id}/invitacion`, {});
  const nuevo = await secretoEntregado(usuario.email);
  const cliente = new Cliente();
  assert.equal((await cliente.solicitar('/auth/restablecer', { secreto: anterior, password: 'una clave segura nueva' })).respuesta.status, 400);
  await db.query("UPDATE recuperaciones SET vence = now() - interval '1 second' WHERE usuario_id = $1", [usuario.id]);
  assert.equal((await cliente.solicitar('/auth/restablecer', { secreto: nuevo, password: 'una clave segura nueva' })).respuesta.status, 400);
  await cliente.entrar('analista@lab001.test');
  await db.query("UPDATE sesiones SET vence = now() - interval '1 second' WHERE hash = $1", [hashSecreto(cliente.cookies.get('minertrace.sesion')!)]);
  assert.equal((await cliente.solicitar('/auth/yo')).respuesta.status, 401);
});

test('los contadores se comparten entre instancias, ignoran proxies no confiables y permiten reintentar al vencer', async () => {
  for (let i = 0; i < 20; i++) {
    const cliente = new Cliente(bases[i % 2]);
    const resultado = await cliente.solicitar('/auth/login', { email: `desconocido${i}@real.test`, password: 'incorrecta' }, { cabeceras: { 'X-Forwarded-For': `192.0.2.${i}` } });
    assert.equal(resultado.respuesta.status, 401);
  }
  const bloqueado = await new Cliente(bases[1]).entrar('analista@lab001.test');
  assert.equal(bloqueado.respuesta.status, 429);
  assert.ok(Number(bloqueado.respuesta.headers.get('retry-after')) > 0);
  await db.query("UPDATE limites_acceso SET vence = now() - interval '1 second'");
  assert.equal((await new Cliente().entrar('analista@lab001.test')).respuesta.status, 200);
});

test('la cola reintenta fallos y dos procesadores concurrentes no entregan dos veces el mismo correo', async () => {
  const { usuario } = await crear('reintento-correo@real.test');
  await db.query('DELETE FROM correos_pendientes WHERE usuario_id <> $1', [usuario.id]);
  const fallido = new ProcesadorCorreos(db, async () => { throw new Error('Servidor SMTP no disponible'); });
  await fallido.procesar();
  const [pendiente] = await db.query('SELECT * FROM correos_pendientes WHERE usuario_id = $1', [usuario.id]);
  assert.equal(pendiente.intentos, 1);
  assert.ok(pendiente.contenido_cifrado);
  await db.query('UPDATE correos_pendientes SET reservado_hasta = now() WHERE id = $1', [pendiente.id]);
  let entregas = 0;
  const enviar = async () => { entregas++; await new Promise((resolver) => setTimeout(resolver, 10)); };
  await Promise.all([new ProcesadorCorreos(db, enviar).procesar(), new ProcesadorCorreos(db, enviar).procesar()]);
  assert.equal(entregas, 1);
  assert.equal((await db.query('SELECT id FROM correos_pendientes WHERE id = $1', [pendiente.id])).length, 0);
});
