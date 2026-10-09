/**
 * Genera PDF de ejemplo en ejemplos/pdf/ para subirlos en la demo:
 * informes de análisis nuevos y contra-análisis de los lotes en garantía.
 * Uso: npm run demo:pdfs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pdfSimple } from '../src/pdfSimple.ts';

const destino = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../ejemplos/pdf');

interface Informe {
  archivo: string;
  laboratorio: string;
  tipo: 'Informe de analisis' | 'Contra-analisis';
  lote: string;
  mineral: string;
  metodo: string;
  fecha: string;
  pureza: string;
  composicion: Record<string, string>;
  analista: string;
  nota: string;
}

const LAB_A = 'Laboratorio Minero Andino (LAB-001)';
const LAB_B = 'Laboratorio de Contraste del Sur (LAB-002)';

const INFORMES: Informe[] = [
  // Contra-análisis (los sube LAB-002 en Laboratorio -> Contra-análisis)
  {
    archivo: 'contra-analisis-LT-2026-0510-oro-disputa.pdf',
    laboratorio: LAB_B,
    tipo: 'Contra-analisis',
    lote: 'LT-2026-0510',
    mineral: 'Dore de oro (Mapiri)',
    metodo: 'Ensayo al fuego',
    fecha: '2026-10-08 10:00 UTC',
    pureza: '80.00',
    composicion: { Au: '80.00', Ag: '17.30', Cu: '2.10', otros: '0.60' },
    analista: 'Rosa Condori',
    nota: 'Certificado: 84.60 %. Diferencia 4.60 puntos > tolerancia 2.00: EN DISPUTA.',
  },
  {
    archivo: 'contra-analisis-LT-2026-0510-oro-dentro-tolerancia.pdf',
    laboratorio: LAB_B,
    tipo: 'Contra-analisis',
    lote: 'LT-2026-0510',
    mineral: 'Dore de oro (Mapiri)',
    metodo: 'Ensayo al fuego',
    fecha: '2026-10-08 10:00 UTC',
    pureza: '84.20',
    composicion: { Au: '84.20', Ag: '13.40', Cu: '1.80', otros: '0.60' },
    analista: 'Rosa Condori',
    nota: 'Certificado: 84.60 %. Diferencia 0.40 puntos: dentro de tolerancia.',
  },
  {
    archivo: 'contra-analisis-LT-2026-0516-estano-disputa.pdf',
    laboratorio: LAB_B,
    tipo: 'Contra-analisis',
    lote: 'LT-2026-0516',
    mineral: 'Concentrado de estano (Caracoles)',
    metodo: 'FRX',
    fecha: '2026-10-08 11:30 UTC',
    pureza: '66.00',
    composicion: { Sn: '66.00', Fe: '5.80', W: '1.60', otros: '26.60' },
    analista: 'Jorge Choque',
    nota: 'Certificado: 70.10 %. Diferencia 4.10 puntos > tolerancia 2.00: EN DISPUTA.',
  },
  {
    archivo: 'contra-analisis-LT-2026-0516-estano-dentro-tolerancia.pdf',
    laboratorio: LAB_B,
    tipo: 'Contra-analisis',
    lote: 'LT-2026-0516',
    mineral: 'Concentrado de estano (Caracoles)',
    metodo: 'FRX',
    fecha: '2026-10-08 11:30 UTC',
    pureza: '69.50',
    composicion: { Sn: '69.50', Fe: '5.00', W: '1.80', otros: '23.70' },
    analista: 'Jorge Choque',
    nota: 'Certificado: 70.10 %. Diferencia 0.60 puntos: dentro de tolerancia.',
  },
  {
    archivo: 'contra-analisis-LT-2026-0503-zinc.pdf',
    laboratorio: LAB_B,
    tipo: 'Contra-analisis',
    lote: 'LT-2026-0503',
    mineral: 'Concentrado de zinc (San Cristobal)',
    metodo: 'ICP-OES',
    fecha: '2026-10-08 15:00 UTC',
    pureza: '51.90',
    composicion: { Zn: '51.90', Fe: '7.90', S: '30.00', otros: '10.20' },
    analista: 'Rosa Condori',
    nota: 'Certificado: 52.30 %. Diferencia 0.40 puntos: dentro de tolerancia.',
  },
  // Informes para registrar análisis nuevos (los sube LAB-001 en Registrar análisis)
  {
    archivo: 'informe-dore-oro-tipuani.pdf',
    laboratorio: LAB_A,
    tipo: 'Informe de analisis',
    lote: '(lote nuevo)',
    mineral: 'Dore de oro (Cooperativa Aurifera Tipuani)',
    metodo: 'Ensayo al fuego',
    fecha: '2026-10-07 09:00 UTC',
    pureza: '89.70',
    composicion: { Au: '89.70', Ag: '8.90', Cu: '1.00', otros: '0.40' },
    analista: 'Ana Quispe',
    nota: 'Copelacion por duplicado.',
  },
  {
    archivo: 'informe-concentrado-plata-potosi.pdf',
    laboratorio: LAB_A,
    tipo: 'Informe de analisis',
    lote: '(lote nuevo)',
    mineral: 'Concentrado de plata (Cerro Rico, Potosi)',
    metodo: 'Absorcion atomica (AAS)',
    fecha: '2026-10-07 11:00 UTC',
    pureza: '43.10',
    composicion: { Ag: '43.10', Pb: '19.20', Zn: '10.10', otros: '27.60' },
    analista: 'Ana Quispe',
    nota: 'Concentrado por flotacion.',
  },
  {
    archivo: 'informe-concentrado-estano-huanuni.pdf',
    laboratorio: LAB_A,
    tipo: 'Informe de analisis',
    lote: '(lote nuevo)',
    mineral: 'Concentrado de estano (Huanuni, Oruro)',
    metodo: 'FRX',
    fecha: '2026-10-07 14:00 UTC',
    pureza: '67.20',
    composicion: { Sn: '67.20', Fe: '6.40', S: '3.00', otros: '23.40' },
    analista: 'Carlos Mamani',
    nota: 'Muestreo por cuarteo, 6 submuestras.',
  },
];

fs.mkdirSync(destino, { recursive: true });
for (const i of INFORMES) {
  const lineas = [
    i.laboratorio,
    `Lote: ${i.lote}`,
    `Mineral: ${i.mineral}`,
    `Metodo: ${i.metodo}     Fecha: ${i.fecha}`,
    `PUREZA: ${i.pureza} %`,
    `Composicion: ${Object.entries(i.composicion).map(([e, p]) => `${e} ${p} %`).join('   ')}`,
    `Analista: ${i.analista}`,
    i.nota,
    '',
    'Documento de ejemplo para la demostracion de MinerTrace.',
  ];
  fs.writeFileSync(path.join(destino, i.archivo), pdfSimple(`${i.tipo} - MinerTrace`, lineas));
  console.log(`  ejemplos/pdf/${i.archivo}`);
}
console.log(`\n${INFORMES.length} PDF generados en ${destino}`);
