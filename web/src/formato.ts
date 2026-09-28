const fechaHora = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
const fecha = new Intl.DateTimeFormat('es', { dateStyle: 'long', timeZone: 'UTC' });

export const formatoFechaHora = (iso: string | null | undefined) => (iso ? `${fechaHora.format(new Date(iso))} UTC` : '—');
export const formatoFecha = (iso: string | null | undefined) => (iso ? fecha.format(new Date(iso)) : '—');
export const acortar = (hash: string | null | undefined, n = 6) => (hash ? `${hash.slice(0, n)}…${hash.slice(-n)}` : '—');
export const formatoPeso = (kg: string) =>
  `${Number(kg).toLocaleString('es', { maximumFractionDigits: 3 })} kg`;

/** Extrae el código de lote de un QR de MinerTrace (URL /verificar/<codigo>) o de texto plano. */
export function codigoDesdeQr(texto: string): string {
  const m = texto.match(/\/verificar\/([^/?#\s]+)/);
  const crudo = m ? m[1] : texto;
  let codigo = crudo;
  try {
    codigo = decodeURIComponent(crudo);
  } catch {
    // Texto con % sueltos: se usa tal cual.
  }
  return codigo.trim().toUpperCase();
}
