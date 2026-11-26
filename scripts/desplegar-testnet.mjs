// Despliega el contrato MinerTrace en Stellar testnet.
//
// 1. Crea (o reutiliza) y fondea con friendbot las cuentas de prueba: admin,
//    laboratorio A, laboratorio B, vendedor de la demo comercial, seis vendedores
//    del directorio y comprador. Las claves quedan en
//    la configuración global del Stellar CLI (~/.config/stellar), nunca en el repo.
// 2. Compila el contrato y lo despliega; el constructor recibe el admin, el
//    token de pago y la tolerancia de pureza.
// 3. Configura el comercio (1 % comprador, reintegro de hasta 0,25 %) y autoriza laboratorios.
//
// Se puede volver a ejecutar en cualquier momento (por ejemplo, tras un
// reinicio de testnet): reutiliza las identidades y despliega un contrato nuevo.
//
// Variables opcionales:
//   TOKEN_CONTRATO  contrato del token de pago (por defecto, el XLM nativo de testnet)
//   TOKEN_NATIVO=false  emite un activo USDC de demostración en testnet (sin dólares reales)
//   TOLERANCIA_BPS  diferencia de pureza aceptada en un contra-análisis (por defecto 200 = 2.00 %)
//   PLAZO_GARANTIA_DIAS  días de inspección desde la recepción acreditada (por defecto 7)
//   PLAZO_GARANTIA_SEG   el mismo plazo en segundos (tiene prioridad; útil para probar)
//   PLAZO_ENTREGA_SEG    segundos para entregar desde la compra (por defecto 86400)
//   COMISION_MINIMA_TOKEN  mínimo en unidades del token de pago (por defecto 20; no son Bs)
//   REINTEGRO_MAXIMO_TOKEN máximo en unidades del mismo token (por defecto 100)
//   DESTINATARIO_PLATAFORMA cuenta pública que recibe la comisión neta (por defecto admin)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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
  vendedorHuanuni: 'minertrace-vendedor-huanuni',
  vendedorPotosi: 'minertrace-vendedor-potosi',
  vendedorTipuani: 'minertrace-vendedor-tipuani',
  vendedorSanSimon: 'minertrace-vendedor-sansimon',
  vendedorColquiri: 'minertrace-vendedor-colquiri',
  vendedorChojlla: 'minertrace-vendedor-chojlla',
  comprador: 'minertrace-comprador',
  // El emisor solo se prepara si se elige explícitamente el USDC sintético.
  ...(!process.env.TOKEN_CONTRATO && process.env.TOKEN_NATIVO === 'false' ? { usdc: 'minertrace-usdc' } : {}),
};
const VENDEDORES = ['vendedor', 'vendedorHuanuni', 'vendedorPotosi', 'vendedorTipuani', 'vendedorSanSimon', 'vendedorColquiri', 'vendedorChojlla'];
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

/** Conversión decimal exacta: estos importes siempre se expresan en el token desplegado. */
function unidadesMinimas(texto, decimales) {
  if (!/^\d+(?:\.\d+)?$/.test(texto)) throw new Error(`Importe de token inválido: ${texto}`);
  const [entero, fraccion = ''] = texto.split('.');
  if (fraccion.length > decimales) throw new Error(`El token solo admite ${decimales} decimales`);
  const importe = BigInt(entero) * 10n ** BigInt(decimales) + BigInt(fraccion.padEnd(decimales, '0') || '0');
  if (importe > (1n << 127n) - 1n) throw new Error('El importe supera el rango i128 del contrato');
  return importe.toString();
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
const destinatario = process.env.DESTINATARIO_PLATAFORMA || direcciones.admin;

paso('Token de pago');
let token;
if (process.env.TOKEN_CONTRATO) {
  token = process.env.TOKEN_CONTRATO;
  console.log(`  ${token} (token indicado; sus cuentas deben poder recibirlo)`);
} else if (process.env.TOKEN_NATIVO !== 'false') {
  token = stellar(['contract', 'id', 'asset', '--asset', 'native', '--network', RED]);
  console.log(`  ${token} (XLM nativo)`);
} else {
  // Activo sintético independiente del USDC real: solo existe en testnet.
  const activo = `USDC:${direcciones.usdc}`;
  const aliasPlataforma = Object.keys(CUENTAS).find((clave) => direcciones[clave] === destinatario);
  if (!aliasPlataforma) {
    // La wallet externa crea su propia línea: no asumimos que disponemos de su firma.
    if (!/^G[A-Z2-7]{55}$/.test(destinatario)) throw new Error('El USDC de demostración necesita una cuenta Stellar clásica como destinatario');
    const respuesta = await fetch(`https://horizon-testnet.stellar.org/accounts/${destinatario}`, { signal: AbortSignal.timeout(15_000) });
    if (!respuesta.ok) throw new Error('No se pudo comprobar la cuenta externa de la plataforma en testnet');
    const cuenta = await respuesta.json();
    const linea = cuenta.balances?.find((saldo) => saldo.asset_code === 'USDC' && saldo.asset_issuer === direcciones.usdc);
    if (!linea?.is_authorized || typeof linea.limit !== 'string' || unidadesMinimas(linea.limit, 7) === '0') {
      throw new Error(`La wallet externa de la plataforma debe crear y autorizar su propia línea de confianza para ${activo} antes de desplegar`);
    }
  }
  // La comisión comercial se paga también a la plataforma: su línea es necesaria para liquidar.
  const receptoras = new Set([...VENDEDORES, 'comprador', ...(aliasPlataforma ? [aliasPlataforma] : [])]);
  for (const clave of receptoras) {
    if (clave === 'usdc') continue; // El emisor no necesita una línea contra sí mismo.
    stellar(['tx', 'new', 'change-trust', '--source-account', CUENTAS[clave], '--network', RED, '--line', activo]);
  }
  stellar([
    'tx', 'new', 'payment', '--source-account', CUENTAS.usdc, '--network', RED,
    '--destination', direcciones.comprador, '--asset', activo, '--amount', (20_000n * 10_000_000n).toString(),
  ]);
  try {
    token = stellar(['contract', 'asset', 'deploy', '--asset', activo, '--source-account', CUENTAS.usdc, '--network', RED]);
  } catch (error) {
    // Un despliegue MinerTrace nuevo puede reutilizar el mismo activo sintético.
    if (!/already.*exist|existing.*contract|ExistingValue/i.test(String(error.stderr || error.message))) throw error;
    token = stellar(['contract', 'id', 'asset', '--asset', activo, '--network', RED]);
    stellar(['contract', 'invoke', '--id', token, '--source-account', CUENTAS.admin, '--network', RED, '--send', 'no', '--', 'decimals']);
  }
  console.log(`  ${token} (USDC sintético de testnet, emisor ${direcciones.usdc}; no representa dólares)`);
}

const tolerancia = process.env.TOLERANCIA_BPS || '200';
if (!/^\d+$/.test(tolerancia) || Number(tolerancia) > 10000) {
  console.error('TOLERANCIA_BPS debe ser un entero entre 0 y 10000');
  process.exit(1);
}

const plazo = process.env.PLAZO_GARANTIA_SEG || String(Math.round(Number(process.env.PLAZO_GARANTIA_DIAS || 7) * 86400));
if (!/^\d+$/.test(plazo) || !Number.isSafeInteger(Number(plazo)) || Number(plazo) === 0) {
  console.error('El plazo de garantía debe ser un número entero de segundos mayor que cero');
  process.exit(1);
}

const plazoEntrega = process.env.PLAZO_ENTREGA_SEG || '86400';
if (!/^\d+$/.test(plazoEntrega) || !Number.isSafeInteger(Number(plazoEntrega)) || Number(plazoEntrega) === 0) {
  console.error('PLAZO_ENTREGA_SEG debe ser un entero seguro de segundos mayor que cero');
  process.exit(1);
}

const decimales = Number(stellar([
  'contract', 'invoke', '--id', token, '--source-account', CUENTAS.admin, '--network', RED, '--send', 'no',
  '--', 'decimals',
]));
if (!Number.isInteger(decimales) || decimales < 0 || decimales > 18) throw new Error('La aplicación admite tokens con entre 0 y 18 decimales');
const comisionMinima = unidadesMinimas(process.env.COMISION_MINIMA_TOKEN || '20', decimales);
const reintegroMaximo = unidadesMinimas(process.env.REINTEGRO_MAXIMO_TOKEN || '100', decimales);

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
  '--plazo_garantia_seg', plazo,
]);
console.log(`  ${contrato}`);

paso('Configurando comercio (importes en el token de pago)');
stellar([
  'contract', 'invoke', '--id', contrato, '--source-account', CUENTAS.admin, '--network', RED, '--send', 'yes',
  '--', 'configurar_comercio', '--destinatario_plataforma', destinatario,
  '--comision_minima', comisionMinima, '--reintegro_maximo', reintegroMaximo, '--plazo_entrega_seg', plazoEntrega,
]);
console.log(`  Comisión comprador: 1 %, mínimo ${process.env.COMISION_MINIMA_TOKEN || '20'} tokens`);
console.log(`  Reintegro vendedor: hasta 0,25 %, coste acreditado y máximo ${process.env.REINTEGRO_MAXIMO_TOKEN || '100'} tokens`);

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

// Solo información pública. El lanzador abre este contrato en una base separada.
writeFileSync(path.join(raiz, 'scripts', 'comercio-testnet.json'), `${JSON.stringify({
  red: RED, contrato_id: contrato, token, version_comercial: 2,
  fecha: new Date().toISOString().slice(0, 10),
  huella_wasm: createHash('sha256').update(readFileSync(wasm)).digest('hex'),
}, null, 2)}\n`);

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
  vendedor    ${direcciones.vendedorHuanuni}  (Huanuni, demo)
  vendedor    ${direcciones.vendedorPotosi}  (Potosí, demo)
  vendedor    ${direcciones.vendedorTipuani}  (Tipuani, demo)
  vendedor    ${direcciones.vendedorSanSimon}  (San Simón, demo)
  vendedor    ${direcciones.vendedorColquiri}  (Colquiri, demo)
  vendedor    ${direcciones.vendedorChojlla}  (Chojlla, demo)
  comprador   ${direcciones.comprador}
  token       ${token}${direcciones.usdc ? ` (USDC sintético; emisor ${direcciones.usdc})` : ''}

Tolerancia de pureza: ${tolerancia} bps · inspección desde recepción: ${plazo} s · entrega: ${plazoEntrega} s
Comercio v2: 1 % comprador, mínimo ${comisionMinima} unidades mínimas; reintegro máximo ${reintegroMaximo}
Destinatario plataforma: ${destinatario} · decimales del token: ${decimales}
`);
