/**
 * Llena MinerTrace con datos de demostración reales en Stellar testnet.
 *
 * Usa la API del servidor en marcha (npm run dev, con ANCLAJE=stellar) igual
 * que la web: inicia sesión como laboratorio, registra lotes y análisis, y
 * firma cada transacción con la cuenta que correspondería en Freighter
 * (laboratorio, vendedor o comprador). Todo queda anclado en el contrato.
 *
 * Las claves se leen de las identidades del Stellar CLI creadas por
 * `npm run contrato:desplegar` (minertrace-lab-a, -lab-b, -vendedor,
 * -comprador), o de DEMO_SECRETO_LAB_A, DEMO_SECRETO_LAB_B,
 * DEMO_SECRETO_VENDEDOR y DEMO_SECRETO_COMPRADOR. No se guardan en ningún lado.
 *
 * Los lotes que ya existen se omiten, así que se puede volver a ejecutar.
 */
import { execFileSync } from 'node:child_process';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { pdfSimple } from '../src/pdfSimple.ts';

const API = process.env.DEMO_API || 'http://localhost:3000/api';
const PASSWORD = 'minertrace123';
const EXPLORADOR = 'https://stellar.expert/explorer/testnet/tx/';

type Destino = 'en_venta' | 'vendido' | 'en_garantia' | 'disputa' | 'corregido' | 'sin_firmar';

interface DatosAnalisis {
  fecha: string;
  metodo: string;
  pureza: string;
  composicion: Record<string, string>;
  observaciones: string;
}

interface LoteDemo {
  codigo: string;
  lab: 'A' | 'B';
  tipo: string;
  peso: string;
  origen: string;
  coordenadas: string;
  analisis: DatosAnalisis;
  destino: Destino;
  precio?: string;
  /** Pureza del contra-análisis del laboratorio B. */
  contra?: string;
  correccion?: { pureza: string; composicion: Record<string, string>; motivo: string };
}

const LOTES: LoteDemo[] = [
  {
    codigo: 'LT-2026-0501',
    lab: 'A',
    tipo: 'Concentrado de estaño',
    peso: '18250.000',
    origen: 'Cooperativa Minera Huanuni, Oruro, Bolivia',
    coordenadas: '-18.289400, -66.838300',
    analisis: {
      fecha: '2026-09-02T10:15:00Z',
      metodo: 'FRX',
      pureza: '68.40',
      composicion: { Sn: '68.40', Fe: '6.20', S: '3.10', otros: '22.30' },
      observaciones: 'Muestreo por cuarteo, 8 submuestras.',
    },
    destino: 'en_venta',
    precio: '85',
  },
  {
    codigo: 'LT-2026-0502',
    lab: 'A',
    tipo: 'Concentrado de plata',
    peso: '4200.000',
    origen: 'Cooperativa Unificada, Cerro Rico, Potosí, Bolivia',
    coordenadas: '-19.619700, -65.753100',
    analisis: {
      fecha: '2026-09-05T14:00:00Z',
      metodo: 'Ensayo al fuego',
      pureza: '45.20',
      composicion: { Ag: '45.20', Pb: '18.40', Zn: '9.70', otros: '26.70' },
      observaciones: 'Doble ensayo; diferencia entre réplicas 0.15 %.',
    },
    destino: 'vendido',
    precio: '140',
    contra: '44.80',
  },
  {
    codigo: 'LT-2026-0503',
    lab: 'A',
    tipo: 'Concentrado de zinc',
    peso: '25600.000',
    origen: 'Operación San Cristóbal, Potosí, Bolivia',
    coordenadas: '-21.123600, -67.204700',
    analisis: {
      fecha: '2026-09-09T09:30:00Z',
      metodo: 'ICP-OES',
      pureza: '52.30',
      composicion: { Zn: '52.30', Fe: '7.80', S: '30.10', otros: '9.80' },
      observaciones: 'Humedad 7.5 %, reportado en base seca.',
    },
    destino: 'en_garantia',
    precio: '60',
  },
  {
    codigo: 'LT-2026-0504',
    lab: 'A',
    tipo: 'Concentrado de plomo',
    peso: '9800.000',
    origen: 'Cooperativa Minera Porco, Potosí, Bolivia',
    coordenadas: '-19.833300, -65.983300',
    analisis: {
      fecha: '2026-09-12T16:45:00Z',
      metodo: 'Absorción atómica (AAS)',
      pureza: '61.75',
      composicion: { Pb: '61.75', Zn: '5.40', Ag: '0.95', otros: '31.90' },
      observaciones: 'Muestra recibida en bolsa sellada N.º 4471.',
    },
    destino: 'disputa',
    precio: '70',
    contra: '58.10',
  },
  {
    codigo: 'LT-2026-0505',
    lab: 'A',
    tipo: 'Concentrado de estaño',
    peso: '15100.000',
    origen: 'Cooperativa Minera Colquiri, La Paz, Bolivia',
    coordenadas: '-17.395000, -67.128600',
    analisis: {
      fecha: '2026-09-16T11:20:00Z',
      metodo: 'FRX',
      pureza: '71.20',
      composicion: { Sn: '71.20', Fe: '5.10', otros: '23.70' },
      observaciones: 'Lectura inicial.',
    },
    destino: 'corregido',
    correccion: {
      pureza: '71.85',
      composicion: { Sn: '71.85', Fe: '5.05', otros: '23.10' },
      motivo: 'Recalibración del espectrómetro con patrón certificado',
    },
  },
  {
    codigo: 'LT-2026-0506',
    lab: 'B',
    tipo: 'Concentrado de wolframio',
    peso: '3300.000',
    origen: 'Mina Chojlla, Yanacachi, La Paz, Bolivia',
    coordenadas: '-16.416700, -67.766700',
    analisis: {
      fecha: '2026-09-20T13:10:00Z',
      metodo: 'FRX',
      pureza: '51.50',
      composicion: { W: '51.50', Fe: '9.30', Mn: '6.10', otros: '33.10' },
      observaciones: 'Equivale a 65.0 % de WO3.',
    },
    destino: 'en_venta',
    precio: '150',
  },
  {
    codigo: 'LT-2026-0507',
    lab: 'A',
    tipo: 'Concentrado de antimonio',
    peso: '6100.000',
    origen: 'Cooperativa Caracota, Potosí, Bolivia',
    coordenadas: '-20.120000, -65.550000',
    analisis: {
      fecha: '2026-09-25T08:40:00Z',
      metodo: 'Volumetría',
      pureza: '58.00',
      composicion: { Sb: '58.00', S: '22.40', otros: '19.60' },
      observaciones: 'Pendiente de firma: sirve para mostrar el flujo con Freighter.',
    },
    destino: 'sin_firmar',
  },
];

// ---- Utilidades ----

function claveDe(variable: string, identidad: string): Keypair {
  let secreto = process.env[variable];
  if (!secreto) {
    try {
      secreto = execFileSync('stellar', ['keys', 'secret', identidad], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      throw new Error(`No se encontró la cuenta ${identidad}: ejecute npm run contrato:desplegar o defina ${variable}`);
    }
  }
  return Keypair.fromSecret(secreto);
}

async function api<T = any>(ruta: string, opciones: { token?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opciones.token) headers.authorization = `Bearer ${opciones.token}`;
  if (opciones.json !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(API + ruta, {
      method: opciones.json !== undefined || opciones.form ? 'POST' : 'GET',
      headers,
      body: opciones.form ?? (opciones.json !== undefined ? JSON.stringify(opciones.json) : undefined),
    });
  } catch {
    throw new Error(`No hay conexión con ${API}: inicie el servidor con npm run dev`);
  }
  const cuerpo = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const detalle = cuerpo?.errores ? ` ${JSON.stringify(cuerpo.errores)}` : '';
    throw new Error(`${ruta}: ${cuerpo?.error ?? res.status}${detalle}`);
  }
  return cuerpo as T;
}

const firmar = (xdr: string, par: Keypair) => {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  tx.sign(par);
  return tx.toXDR();
};

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (texto: string) => console.log(`  ${texto}`);

function formularioAnalisis(datos: DatosAnalisis, lote: LoteDemo, laboratorio: string, extra: Record<string, string> = {}) {
  const f = new FormData();
  f.set('fecha_analisis', datos.fecha);
  f.set('metodo', datos.metodo);
  f.set('pureza', datos.pureza);
  f.set('composicion', JSON.stringify(datos.composicion));
  f.set('observaciones', datos.observaciones);
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  const lineas = [
    `Lote: ${lote.codigo}   Fecha: ${datos.fecha.slice(0, 16).replace('T', ' ')} UTC   Metodo: ${datos.metodo}`,
    `Origen: ${lote.origen}`,
    `Pureza: ${datos.pureza} %`,
    Object.entries(datos.composicion)
      .map(([e, p]) => `${e} ${p} %`)
      .join('   '),
  ];
  const pdf = pdfSimple(`Informe de analisis - ${laboratorio}`, lineas.map((l) => l.normalize('NFD').replace(/[̀-ͯ]/g, '')));
  f.set('pdf', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), `informe-${lote.codigo}.pdf`);
  return f;
}

// ---- Programa ----

const info = await api<{ anclaje: string; firma_laboratorio: 'wallet' | 'servidor'; contrato_id: string }>('/publico/info');
if (info.anclaje !== 'stellar') {
  console.error('El servidor está en modo simulado (ANCLAJE=mock). Configure ANCLAJE=stellar en server/.env (ver README).');
  process.exit(1);
}
console.log(`Poblando la demo en el contrato ${info.contrato_id} (firma del laboratorio: ${info.firma_laboratorio})\n`);

const cuentas = {
  A: claveDe('DEMO_SECRETO_LAB_A', 'minertrace-lab-a'),
  B: claveDe('DEMO_SECRETO_LAB_B', 'minertrace-lab-b'),
  vendedor: claveDe('DEMO_SECRETO_VENDEDOR', 'minertrace-vendedor'),
  comprador: claveDe('DEMO_SECRETO_COMPRADOR', 'minertrace-comprador'),
};

const login = async (email: string) => (await api<{ token: string }>('/auth/login', { json: { email, password: PASSWORD } })).token;
const tokens = {
  A: await login('analista@lab001.test'),
  supervisorA: await login('supervisor@lab001.test'),
  B: await login('analista@lab002.test'),
};

// Las cuentas firmantes deben ser las de los laboratorios registrados en el servidor.
for (const lab of ['A', 'B'] as const) {
  const { laboratorio } = await api<{ laboratorio: { id: string; cuenta_publica: string } }>('/auth/yo', { token: tokens[lab] });
  if (laboratorio.cuenta_publica !== cuentas[lab].publicKey()) {
    console.error(
      `La cuenta de ${laboratorio.id} en el servidor (${laboratorio.cuenta_publica}) no es la de minertrace-lab-${lab.toLowerCase()}.` +
        '\nUse en server/.env las cuentas del script de despliegue y una base de datos nueva.',
    );
    process.exit(1);
  }
}

/** Ancla una versión: con la wallet del laboratorio, o esperando al servidor si la firma él. */
async function anclar(lab: 'A' | 'B', analisisId: string, version: number) {
  const token = lab === 'A' ? tokens.A : tokens.B;
  const detalle = async () => (await api(`/analisis/${analisisId}`, { token })).versiones.find((v: any) => v.version === version);
  const actual = await detalle();
  if (actual.estado_anclaje === 'anclado') return;

  if (info.firma_laboratorio === 'wallet' && !actual.firma_servidor) {
    const ruta = `/analisis/${analisisId}/v/${version}/firma`;
    const cuenta = cuentas[lab].publicKey();
    const preparado = await api<{ xdr?: string; tx_id?: string }>(ruta, { token, json: { cuenta } });
    if (preparado.xdr) {
      const r = await api<{ tx_id: string }>(`${ruta}/enviar`, { token, json: { cuenta, xdr: firmar(preparado.xdr, cuentas[lab]) } });
      log(`anclado ${analisisId} v${version} · ${EXPLORADOR}${r.tx_id}`);
    }
    return;
  }
  // Lo firma el servidor (semilla o FIRMA_LABORATORIO=servidor): se espera al procesador.
  for (let i = 0; i < 45; i++) {
    const v = await detalle();
    if (v.estado_anclaje === 'anclado') {
      log(`anclado ${analisisId} v${version} · ${EXPLORADOR}${v.tx_id}`);
      return;
    }
    if (v.ultimo_error) log(`(reintentando: ${v.ultimo_error})`);
    await esperar(2000);
  }
  throw new Error(`${analisisId} v${version} no se ancló a tiempo`);
}

async function mercado(accion: string, quien: 'vendedor' | 'comprador', loteId: string, precio?: string) {
  const par = cuentas[quien];
  const { xdr } = await api<{ xdr: string }>('/mercado/transacciones', {
    json: { accion, cuenta: par.publicKey(), lote_id: loteId, precio },
  });
  const r = await api<{ tx_id: string }>('/mercado/transacciones/enviar', {
    json: { accion, cuenta: par.publicKey(), xdr: firmar(xdr, par) },
  });
  log(`${accion} (${quien}) · ${EXPLORADOR}${r.tx_id}`);
}

async function contraAnalisis(lote: LoteDemo, pureza: string) {
  const datos: DatosAnalisis = {
    fecha: '2026-10-01T10:00:00Z',
    metodo: 'ICP-OES',
    pureza,
    composicion: { [Object.keys(lote.analisis.composicion)[0]]: pureza },
    observaciones: 'Contra-análisis a pedido del comprador.',
  };
  const nombreLab = 'Laboratorio de Contraste del Sur';
  if (info.firma_laboratorio === 'wallet') {
    const cuenta = cuentas.B.publicKey();
    const prep = await api<{ xdr: string; registro: unknown; pdf_nombre: string }>('/contra-analisis/preparar', {
      token: tokens.B,
      form: formularioAnalisis(datos, lote, nombreLab, { lote_id: lote.codigo, cuenta }),
    });
    const r = await api<{ tx_id: string }>('/contra-analisis/enviar', {
      token: tokens.B,
      json: { registro: prep.registro, pdf_nombre: prep.pdf_nombre, xdr: firmar(prep.xdr, cuentas.B) },
    });
    log(`contra-análisis ${pureza} % (LAB-002) · ${EXPLORADOR}${r.tx_id}`);
  } else {
    const r = await api<{ tx_id: string }>('/contra-analisis', {
      token: tokens.B,
      form: formularioAnalisis(datos, lote, nombreLab, { lote_id: lote.codigo }),
    });
    log(`contra-análisis ${pureza} % (LAB-002) · ${EXPLORADOR}${r.tx_id}`);
  }
}

async function estadoComercial(loteId: string): Promise<string | null> {
  return (await api(`/mercado/lotes/${loteId}`)).estado?.estado ?? null;
}

// Lote de ejemplo de la semilla: se ancla (si falta) y se publica.
console.log('LT-2026-0457 · lote de ejemplo de la semilla');
const semilla = (await api(`/analisis/AN-2026-0001`, { token: tokens.A }).catch(() => null)) as any;
if (semilla?.lote?.id === 'LT-2026-0457') {
  await anclar('A', 'AN-2026-0001', 1);
  const estado = await estadoComercial('LT-2026-0457');
  if (estado === 'Certificado' && semilla.lote.dueno === cuentas.vendedor.publicKey()) {
    await mercado('list_batch', 'vendedor', 'LT-2026-0457', '120');
  } else {
    log(`estado ${estado}${semilla.lote.dueno !== cuentas.vendedor.publicKey() ? ' (su dueño no es minertrace-vendedor: no se publica)' : ''}`);
  }
} else {
  log('no existe en esta base (se omite)');
}

const existentes = new Set<string>();
for (const token of [tokens.A, tokens.B]) {
  for (const l of await api<{ id: string }[]>('/lotes', { token })) existentes.add(l.id);
}

for (const lote of LOTES) {
  console.log(`\n${lote.codigo} · ${lote.tipo} · ${lote.destino.replace('_', ' ')}`);
  if (existentes.has(lote.codigo)) {
    log('ya existe: se omite');
    continue;
  }
  const token = lote.lab === 'A' ? tokens.A : tokens.B;
  const laboratorio = lote.lab === 'A' ? 'Laboratorio Minero Andino' : 'Laboratorio de Contraste del Sur';
  await api('/lotes', {
    token,
    json: {
      codigo: lote.codigo,
      tipo_mineral: lote.tipo,
      peso_kg: lote.peso,
      origen: lote.origen,
      coordenadas: lote.coordenadas,
      dueno: cuentas.vendedor.publicKey(),
    },
  });
  const form = formularioAnalisis(lote.analisis, lote, laboratorio, { lote_id: lote.codigo });
  const { analisis_id } = await api<{ analisis_id: string }>('/analisis', { token, form });
  log(`registrado ${analisis_id} (${lote.analisis.pureza} %)`);
  if (lote.destino === 'sin_firmar') {
    log(info.firma_laboratorio === 'wallet' ? 'queda esperando la firma del laboratorio con Freighter' : 'lo ancla el servidor');
    continue;
  }
  await anclar(lote.lab, analisis_id, 1);

  if (lote.correccion) {
    const datos = { ...lote.analisis, pureza: lote.correccion.pureza, composicion: lote.correccion.composicion };
    await api(`/analisis/${analisis_id}/versiones`, {
      token: tokens.supervisorA,
      form: formularioAnalisis(datos, lote, laboratorio, { motivo_correccion: lote.correccion.motivo }),
    });
    log(`corrección v2 (${lote.correccion.pureza} %): ${lote.correccion.motivo}`);
    await anclar('A', analisis_id, 2);
  }

  if (!lote.precio) continue;
  await mercado('list_batch', 'vendedor', lote.codigo, lote.precio);
  if (lote.destino === 'en_venta') continue;
  await mercado('buy', 'comprador', lote.codigo);
  if (lote.contra) await contraAnalisis(lote, lote.contra);
  if (lote.destino === 'vendido') await mercado('confirm', 'comprador', lote.codigo);
  log(`estado final: ${await estadoComercial(lote.codigo)}`);
}

console.log(`
Listo. Abra http://localhost:5173 y revise:
  Mercado ............ LT-2026-0457, 0501 y 0506 en venta
  Mis lotes .......... vendedor: 0503 en garantía, 0504 en disputa · comprador: 0502 comprado
  Verificar .......... /verificar/LT-2026-0505 (dos versiones) y /verificar/LT-2026-0504 (línea de tiempo)
  Portal (LAB-001) ... AN de LT-2026-0507 espera la firma con Freighter`);
