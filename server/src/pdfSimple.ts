/**
 * Genera un PDF de una página con líneas de texto. Solo se usa para los datos
 * de demostración y las pruebas; los informes reales los sube el laboratorio.
 */
export function pdfSimple(titulo: string, lineas: string[]): Buffer {
  const escapar = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const texto = [
    'BT /F1 16 Tf 56 780 Td',
    `(${escapar(titulo)}) Tj`,
    '/F1 11 Tf 0 -28 Td 15 TL',
    ...lineas.map((l) => `(${escapar(l)}) '`),
    'ET',
  ].join('\n');
  const contenido = Buffer.from(texto, 'latin1');

  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${contenido.length} >>\nstream\n${contenido.toString('latin1')}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objetos.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const inicioXref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
