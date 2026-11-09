import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import bcrypt from 'bcryptjs';
import { StrKey } from '@stellar/stellar-sdk';
import { secretoAleatorio } from '../src/auth.ts';
import { conectar } from '../src/db/index.ts';
import { emitirRecuperacion, validarUsuario } from '../src/servicios/cuentas.ts';

// Aprovisionamiento local: no expone una ruta pública de alta de laboratorios.
const preguntas = createInterface({ input: stdin, output: stdout });
try {
  const laboratorio = (await preguntas.question('ID del laboratorio (ej. LAB-003): ')).trim().toUpperCase();
  if (!/^LAB-[A-Z0-9-]{1,40}$/.test(laboratorio)) throw new Error('ID de laboratorio inválido');
  const nombreLaboratorio = (await preguntas.question('Nombre del laboratorio: ')).trim();
  const cuenta = (await preguntas.question('Cuenta pública Stellar del laboratorio (G...): ')).trim();
  if (!nombreLaboratorio || nombreLaboratorio.length > 200 || !StrKey.isValidEd25519PublicKey(cuenta)) throw new Error('Revise el nombre y la cuenta pública del laboratorio');
  const datos = validarUsuario({
    nombre: await preguntas.question('Nombre del supervisor: '),
    email: await preguntas.question('Correo del supervisor: '),
    rol: 'supervisor',
  });
  const hash = await bcrypt.hash(secretoAleatorio(), 12);
  const db = await conectar();
  try {
    await db.transaccion(async (conexion) => {
      await conexion.query('INSERT INTO laboratorios (id, nombre, cuenta_publica) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING', [laboratorio, nombreLaboratorio, cuenta]);
      const [existente] = await conexion.query('SELECT * FROM laboratorios WHERE id = $1 FOR UPDATE', [laboratorio]);
      if (existente.nombre !== nombreLaboratorio || existente.cuenta_publica !== cuenta) throw new Error('El laboratorio existente tiene otro nombre o cuenta pública');
      const [usuario] = await conexion.query(
        `INSERT INTO usuarios (nombre, email, rol, laboratorio_id, password_hash) VALUES ($1, $2, 'supervisor', $3, $4)
         ON CONFLICT (email) DO NOTHING RETURNING id, email, revision_acceso`, [datos.nombre, datos.email, laboratorio, hash],
      );
      if (!usuario) throw new Error('Ese correo ya tiene una cuenta; gestione su acceso desde el portal');
      await emitirRecuperacion(conexion, usuario);
    });
    console.log('Supervisor creado. El servidor enviará su invitación por SMTP al procesar la cola. El enlace vence en 30 minutos.');
    console.log('Con ANCLAJE=stellar, el laboratorio también debe estar autorizado en el contrato.');
  } finally { await db.cerrar(); }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'No se pudo crear el supervisor');
  process.exitCode = 1;
} finally { preguntas.close(); }
