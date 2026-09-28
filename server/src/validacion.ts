/**
 * Validación y normalización de entradas. Todo lo que entra al registro
 * canónico sale de aquí con formato fijo (decimales como texto, fechas ISO UTC),
 * para que el hash sea reproducible.
 */

export class ErrorValidacion extends Error {
  errores: Record<string, string>;
  constructor(errores: Record<string, string>) {
    super('Datos inválidos');
    this.errores = errores;
  }
}

type Entrada = Record<string, unknown>;

class Validador {
  errores: Record<string, string> = {};

  texto(entrada: Entrada, campo: string, opciones: { max: number; opcional?: boolean }): string {
    const valor = entrada[campo];
    const texto = typeof valor === 'string' ? valor.trim().normalize('NFC') : '';
    if (!texto && !opciones.opcional) this.errores[campo] = 'Campo obligatorio';
    else if (texto.length > opciones.max) this.errores[campo] = `Máximo ${opciones.max} caracteres`;
    return texto;
  }

  /** Decimal positivo con como mucho `decimales` cifras, devuelto con precisión fija. */
  decimal(valor: unknown, campo: string, decimales: number, max: number): string {
    const texto = String(valor ?? '').trim().replace(',', '.');
    const forma = new RegExp(`^\\d+(\\.\\d{1,${decimales}})?$`);
    if (!forma.test(texto)) {
      this.errores[campo] = `Número con hasta ${decimales} decimales`;
      return '';
    }
    const [entero, fraccion = ''] = texto.split('.');
    const normalizado = `${Number.parseInt(entero, 10)}.${fraccion.padEnd(decimales, '0')}`;
    if (Number(normalizado) > max) this.errores[campo] = `No puede superar ${max}`;
    return normalizado;
  }

  lanzarSiHayErrores() {
    if (Object.keys(this.errores).length > 0) throw new ErrorValidacion(this.errores);
  }
}

/** Convierte "75.00" en centésimas (7500) sin errores de coma flotante. */
const aCentesimas = (valor: string) => Number.parseInt(valor.replace('.', ''), 10);

export const CODIGO_LOTE = /^[A-Z0-9][A-Z0-9-]{2,39}$/;

export interface LoteValidado {
  codigo: string | null;
  tipo_mineral: string;
  peso_kg: string;
  origen: string;
  coordenadas: string | null;
}

export function validarLote(entrada: Entrada): LoteValidado {
  const v = new Validador();
  const codigoCrudo = v.texto(entrada, 'codigo', { max: 40, opcional: true }).toUpperCase();
  if (codigoCrudo && !CODIGO_LOTE.test(codigoCrudo)) {
    v.errores.codigo = 'Use mayúsculas, números y guiones (ej. LT-2026-0457)';
  }
  const tipo_mineral = v.texto(entrada, 'tipo_mineral', { max: 80 });
  const peso_kg = v.decimal(entrada.peso_kg, 'peso_kg', 3, 10_000_000);
  if (peso_kg && Number(peso_kg) === 0) v.errores.peso_kg = 'Debe ser mayor que 0';
  const origen = v.texto(entrada, 'origen', { max: 200 });

  let coordenadas: string | null = null;
  const coordCrudas = v.texto(entrada, 'coordenadas', { max: 60, opcional: true });
  if (coordCrudas) {
    const m = coordCrudas.match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
    const lat = m ? Number(m[1]) : NaN;
    const lon = m ? Number(m[2]) : NaN;
    if (!m || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      v.errores.coordenadas = 'Formato "latitud, longitud" (ej. -19.5836, -65.7531)';
    } else {
      coordenadas = `${lat.toFixed(6)},${lon.toFixed(6)}`;
    }
  }
  v.lanzarSiHayErrores();
  return { codigo: codigoCrudo || null, tipo_mineral, peso_kg, origen, coordenadas };
}

export interface AnalisisValidado {
  fecha_analisis: string;
  metodo: string;
  pureza: string;
  composicion: Record<string, string>;
  observaciones: string;
}

const CLAVE_ELEMENTO = /^([A-Z][a-z]?|otros)$/;

export function validarAnalisis(entrada: Entrada): AnalisisValidado {
  const v = new Validador();

  let fecha_analisis = '';
  const fechaCruda = v.texto(entrada, 'fecha_analisis', { max: 40 });
  if (fechaCruda) {
    const fecha = new Date(fechaCruda);
    if (Number.isNaN(fecha.getTime())) v.errores.fecha_analisis = 'Fecha inválida';
    else if (fecha.getTime() > Date.now() + 5 * 60 * 1000) v.errores.fecha_analisis = 'No puede ser futura';
    else fecha_analisis = fecha.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  const metodo = v.texto(entrada, 'metodo', { max: 60 });
  const pureza = v.decimal(entrada.pureza, 'pureza', 2, 100);

  // La composición llega como objeto o como JSON (formularios multipart).
  let crudo: unknown = entrada.composicion;
  if (typeof crudo === 'string') {
    try {
      crudo = JSON.parse(crudo);
    } catch {
      crudo = null;
    }
  }
  const composicion: Record<string, string> = {};
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo) || Object.keys(crudo).length === 0) {
    v.errores.composicion = 'Indique al menos un elemento';
  } else {
    let total = 0;
    for (const [clave, valor] of Object.entries(crudo as Entrada)) {
      const elemento = clave.trim();
      if (!CLAVE_ELEMENTO.test(elemento)) {
        v.errores.composicion = `"${clave}" no es un símbolo químico válido (ej. Sn, Ag, Pb) ni "otros"`;
        continue;
      }
      if (elemento in composicion) {
        v.errores.composicion = `Elemento repetido: ${elemento}`;
        continue;
      }
      const porcentaje = v.decimal(valor, `composicion.${elemento}`, 2, 100);
      if (porcentaje) {
        composicion[elemento] = porcentaje;
        total += aCentesimas(porcentaje);
      }
    }
    if (total > 10000) v.errores.composicion = `La composición suma ${(total / 100).toFixed(2)}%, más de 100%`;
  }

  const observaciones = v.texto(entrada, 'observaciones', { max: 2000, opcional: true });
  v.lanzarSiHayErrores();
  return { fecha_analisis, metodo, pureza, composicion, observaciones };
}

export function validarPureza(valor: unknown): string {
  const v = new Validador();
  const pureza = v.decimal(valor, 'pureza', 2, 100);
  v.lanzarSiHayErrores();
  return pureza;
}

export function validarMotivo(entrada: Entrada): string {
  const v = new Validador();
  const motivo = v.texto(entrada, 'motivo_correccion', { max: 500 });
  v.lanzarSiHayErrores();
  return motivo;
}
