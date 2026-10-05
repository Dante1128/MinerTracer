// Despliega el contrato MinerTrace en Stellar testnet.
//
// 1. Crea (o reutiliza) y fondea con friendbot las cuentas de prueba: admin,
//    laboratorio A, laboratorio B, vendedor y comprador. Las claves quedan en
//    la configuración global del Stellar CLI (~/.config/stellar), nunca en el repo.
// 2. Compila el contrato y lo despliega; el constructor recibe el admin, el
//    token de pago y la tolerancia de pureza.
// 3. Autoriza los dos laboratorios e imprime el CONTRACT_ID.
//
// Se puede volver a ejecutar en cualquier momento (por ejemplo, tras un
// reinicio de testnet): reutiliza las identidades y despliega un contrato nuevo.
//
// Variables opcionales:
//   TOKEN_CONTRATO  contrato del token de pago (por defecto, el XLM nativo de testnet)
//   TOLERANCIA_BPS  diferencia de pureza aceptada en un contra-análisis (por defecto 200 = 2.00 %)
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RED = 'testnet';
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirContrato = path.join(raiz, 'contracts', 'minertrace');
const wasm = path.join(dirContrato, 'target', 'wasm32v1-none', 'release', 'minertrace.wasm');

const CUENTAS = {
  admin: 'minertrace-admin',
  labA: 'minertrace-lab-a',
  labB: 'minertrace-lab-b',
  vendedor: 'minertrace-vendedor',
  comprador: 'minertrace-comprador',
};
const LABORATORIOS = [
  ['labA', 'Laboratorio Minero Andino (demo)'],
  ['labB', 'Laboratorio de Contraste del Sur (demo)'],
];

function stellar(args, opciones = {}) {
  const salida = execFileSync('stellar', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opciones });
  return (salida ?? '').trim();
}

function paso(texto) {
  console.log(`\n▶ ${texto}`);
}

function direccion(nombre) {
  try {
    return stellar(['keys', 'public-key', nombre]);
  } catch {
    return null;
  }
}

/** Crea la identidad si no existe y se asegura de que la cuenta esté fondeada en testnet. */
function prepararCuenta(nombre) {
  if (!direccion(nombre)) {
    stellar(['keys', 'generate', nombre, '--network', RED, '--fund']);
  } else {
    try {
      stellar(['keys', 'fund', nombre, '--network', RED]);
    } catch (error) {
      // friendbot rechaza fondear dos veces; la cuenta ya existe y tiene saldo.
      const detalle = String(error.stderr || error.message).split('\n')[0];
      console.log(`  (${nombre}: ${detalle || 'ya fondeada'})`);
    }
  }
  const valor = direccion(nombre);
  console.log(`  ${nombre.padEnd(22)} ${valor}`);
  return valor;
}

try {
  stellar(['--version']);
} catch {
  console.error('No se encontró el Stellar CLI. Instálelo: https://developers.stellar.org/docs/tools/cli/install-cli');
  process.exit(1);
}

paso('Cuentas de prueba (friendbot)');
const direcciones = Object.fromEntries(Object.entries(CUENTAS).map(([clave, nombre]) => [clave, prepararCuenta(nombre)]));

paso('Token de pago');
const token = process.env.TOKEN_CONTRATO || stellar(['contract', 'id', 'asset', '--asset', 'native', '--network', RED]);
console.log(`  ${token}${process.env.TOKEN_CONTRATO ? '' : ' (XLM nativo)'}`);

const tolerancia = process.env.TOLERANCIA_BPS || '200';
if (!/^\d+$/.test(tolerancia) || Number(tolerancia) > 10000) {
  console.error('TOLERANCIA_BPS debe ser un entero entre 0 y 10000');
  process.exit(1);
}

paso('Compilando el contrato');
stellar(['contract', 'build'], { cwd: dirContrato, stdio: ['ignore', 'ignore', 'inherit'] });

paso('Desplegando');
const contrato = stellar([
  'contract', 'deploy',
  '--wasm', wasm,
  '--source-account', CUENTAS.admin,
  '--network', RED,
  '--',
  '--admin', direcciones.admin,
  '--token', token,
  '--tolerancia_bps', tolerancia,
]);
console.log(`  ${contrato}`);

paso('Autorizando laboratorios');
for (const [clave, nombre] of LABORATORIOS) {
  stellar([
    'contract', 'invoke', '--id', contrato, '--source-account', CUENTAS.admin, '--network', RED, '--send', 'yes',
    '--', 'add_lab', '--lab', direcciones[clave], '--nombre', nombre,
  ]);
  const activo = stellar([
    'contract', 'invoke', '--id', contrato, '--source-account', CUENTAS.admin, '--network', RED, '--send', 'no',
    '--', 'is_lab', '--lab', direcciones[clave],
  ]);
  console.log(`  ${nombre}: ${activo === 'true' ? 'autorizado' : `ERROR (is_lab = ${activo})`}`);
  if (activo !== 'true') process.exit(1);
}

console.log(`
✔ Contrato desplegado en ${RED}

CONTRACT_ID=${contrato}

Explorador: https://stellar.expert/explorer/testnet/contract/${contrato}

Direcciones públicas (las claves secretas siguen solo en el Stellar CLI;
para verlas: stellar keys secret <nombre>):
  admin       ${direcciones.admin}
  laboratorio ${direcciones.labA}  (${LABORATORIOS[0][1]})
  laboratorio ${direcciones.labB}  (${LABORATORIOS[1][1]})
  vendedor    ${direcciones.vendedor}
  comprador   ${direcciones.comprador}
  token       ${token}
`);
