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

  // ---- Oro ----
  {
    codigo: 'LT-2026-0508',
    lab: 'A',
    tipo: 'Doré de oro',
    peso: '12.450',
    origen: 'Cooperativa Aurífera Tipuani, Larecaja, La Paz, Bolivia',
    coordenadas: '-15.546900, -68.016700',
    analisis: {
      fecha: '2026-09-03T15:00:00Z',
      metodo: 'Ensayo al fuego',
      pureza: '88.40',
      composicion: { Au: '88.40', Ag: '9.80', Cu: '1.20', otros: '0.60' },
      observaciones: 'Copelación por duplicado; barra N.º TP-0912.',
    },
    destino: 'en_venta',
    precio: '300',
  },
  {
    codigo: 'LT-2026-0509',
    lab: 'A',
    tipo: 'Doré de oro',
    peso: '8.920',
    origen: 'Cooperativa Aurífera Guanay, Larecaja, La Paz, Bolivia',
    coordenadas: '-15.497800, -67.881500',
    analisis: {
      fecha: '2026-09-06T10:30:00Z',
      metodo: 'Ensayo al fuego',
      pureza: '91.25',
      composicion: { Au: '91.25', Ag: '7.40', Cu: '0.90', otros: '0.45' },
      observaciones: 'Barra N.º GY-0447.',
    },
    destino: 'vendido',
    precio: '320',
    contra: '91.10',
  },
  {
    codigo: 'LT-2026-0510',
    lab: 'A',
    tipo: 'Doré de oro',
    peso: '15.300',
    origen: 'Cooperativa Aurífera Mapiri, Larecaja, La Paz, Bolivia',
    coordenadas: '-15.300000, -68.216700',
    analisis: {
      fecha: '2026-09-11T12:10:00Z',
      metodo: 'ICP-OES',
      pureza: '84.60',
      composicion: { Au: '84.60', Ag: '13.10', Cu: '1.70', otros: '0.60' },
      observaciones: 'Muestra por perforación en tres puntos de la barra.',
    },
    destino: 'en_garantia',
    precio: '280',
  },
  {
    codigo: 'LT-2026-0511',
    lab: 'A',
    tipo: 'Doré de oro',
    peso: '6.780',
    origen: 'Cooperativa Aurífera San Simón, Beni, Bolivia',
    coordenadas: '-13.433300, -62.266700',
    analisis: {
      fecha: '2026-09-14T09:45:00Z',
      metodo: 'Ensayo al fuego',
      pureza: '79.30',
      composicion: { Au: '79.30', Ag: '17.20', Cu: '2.80', otros: '0.70' },
      observaciones: 'Barra con inclusiones superficiales.',
    },
    destino: 'disputa',
    precio: '250',
    contra: '76.90',
  },
  {
    codigo: 'LT-2026-0518',
    lab: 'A',
    tipo: 'Doré de oro',
    peso: '10.050',
    origen: 'Cooperativa Aurífera Tipuani, Larecaja, La Paz, Bolivia',
    coordenadas: '-15.546900, -68.016700',
    analisis: {
      fecha: '2026-09-28T11:00:00Z',
      metodo: 'Ensayo al fuego',
      pureza: '86.10',
      composicion: { Au: '86.10', Ag: '12.20', Cu: '1.20', otros: '0.50' },
      observaciones: 'Pendiente de firma: barra N.º TP-0931.',
    },
    destino: 'sin_firmar',
  },

  // ---- Plata ----
  {
    codigo: 'LT-2026-0512',
    lab: 'A',
    tipo: 'Concentrado de plata',
    peso: '6800.000',
    origen: 'Cooperativa Minera Pulacayo, Uyuni, Potosí, Bolivia',
    coordenadas: '-20.410600, -66.687500',
    analisis: {
      fecha: '2026-09-07T08:20:00Z',
      metodo: 'Absorción atómica (AAS)',
      pureza: '38.60',
      composicion: { Ag: '38.60', Pb: '21.30', Zn: '11.40', otros: '28.70' },
      observaciones: 'Concentrado por flotación.',
    },
    destino: 'en_venta',
    precio: '110',
  },
  {
    codigo: 'LT-2026-0513',
    lab: 'A',
    tipo: 'Doré de plata',
    peso: '320.000',
    origen: 'Planta San Bartolomé, Potosí, Bolivia',
    coordenadas: '-19.583300, -65.716700',
    analisis: {
      fecha: '2026-09-10T17:00:00Z',
      metodo: 'Volumetría',
      pureza: '97.20',
      composicion: { Ag: '97.20', Au: '0.35', Cu: '2.10', otros: '0.35' },
      observaciones: 'Método de Volhard; lingotes SB-221 a SB-228.',
    },
    destino: 'vendido',
    precio: '200',
    contra: '97.05',
  },
  {
    codigo: 'LT-2026-0514',
    lab: 'A',
    tipo: 'Concentrado de plata',
    peso: '5150.000',
    origen: 'Cooperativa Minera Colquechaquita, Potosí, Bolivia',
    coordenadas: '-19.300000, -65.583300',
    analisis: {
      fecha: '2026-09-18T14:25:00Z',
      metodo: 'Ensayo al fuego',
      pureza: '41.30',
      composicion: { Ag: '41.30', Pb: '16.80', Sb: '4.20', otros: '37.70' },
      observaciones: 'Lectura inicial.',
    },
    destino: 'corregido',
    correccion: {
      pureza: '41.75',
      composicion: { Ag: '41.75', Pb: '16.60', Sb: '4.15', otros: '37.50' },
      motivo: 'Corrección por pérdida en copelación (factor de recuperación)',
    },
  },

  // ---- Estaño ----
  {
    codigo: 'LT-2026-0515',
    lab: 'A',
    tipo: 'Concentrado de estaño',
    peso: '21300.000',
    origen: 'Cooperativa Minera Siglo XX, Llallagua, Potosí, Bolivia',
    coordenadas: '-18.424200, -66.583900',
    analisis: {
      fecha: '2026-09-04T13:40:00Z',
      metodo: 'FRX',
      pureza: '64.80',
      composicion: { Sn: '64.80', Fe: '8.10', S: '2.60', otros: '24.50' },
      observaciones: 'Concentrado gravimétrico.',
    },
    destino: 'en_venta',
    precio: '75',
  },
  {
    codigo: 'LT-2026-0516',
    lab: 'A',
    tipo: 'Concentrado de estaño',
    peso: '11750.000',
    origen: 'Cooperativa Minera Caracoles, Inquisivi, La Paz, Bolivia',
    coordenadas: '-16.966700, -67.200000',
    analisis: {
      fecha: '2026-09-17T10:05:00Z',
      metodo: 'FRX',
      pureza: '70.10',
      composicion: { Sn: '70.10', Fe: '4.90', W: '1.80', otros: '23.20' },
      observaciones: 'Contiene trazas de wolframio.',
    },
    destino: 'en_garantia',
    precio: '90',
  },
  {
    codigo: 'LT-2026-0517',
    lab: 'B',
    tipo: 'Concentrado de estaño',
    peso: '19400.000',
    origen: 'Cooperativa Minera Huanuni, Oruro, Bolivia',
    coordenadas: '-18.289400, -66.838300',
    analisis: {
      fecha: '2026-09-22T09:15:00Z',
      metodo: 'ICP-OES',
      pureza: '66.35',
      composicion: { Sn: '66.35', Fe: '6.70', S: '2.90', otros: '24.05' },
      observaciones: 'Certificado por el laboratorio de contraste.',
    },
    destino: 'en_venta',
    precio: '80',
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
  Mercado ............ oro (0508), plata (0512), estaño (0457, 0501, 0515, 0517) y wolframio (0506) en venta
  Mis lotes .......... vendedor: en garantía 0503, 0510, 0516 · en disputa 0504, 0511 · comprador: comprados 0502, 0509, 0513
  Verificar .......... dos versiones: LT-2026-0505 y LT-2026-0514 · línea de tiempo: LT-2026-0509 o LT-2026-0511
  Portal (LAB-001) ... LT-2026-0507 y LT-2026-0518 esperan la firma con Freighter
  Explorador ......... https://stellar.expert/explorer/testnet/contract/${info.contrato_id}`);
