import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ErrorApi } from './api.ts';
import type { EntradaAnuncio, CotizacionComercial, PoliticaComercial, PerfilComercial, DetalleOperacionComercial } from './api.ts';
export type { TipoParticipante, PerfilPublico, PerfilComercial, EntradaAnuncio, AnuncioComercial, EntradaOferta,
  OfertaComercial, PoliticaComercial, CotizacionComercial, OrdenComercial, EvidenciaComercial, DetalleOperacionComercial } from './api.ts';
import { useWallet } from './wallet.tsx';
import type { InfoToken } from './mercado.ts';

export const prepararPublicacion = (datos: EntradaAnuncio, clienteId: string) => ({ ...datos, cliente_id: clienteId,
  lote_id: datos.lote_id || null, gastos_ensayo: datos.gastos_ensayo || '0', gastos_traslado: datos.gastos_traslado || '0',
  oferta_externa_neta: datos.oferta_externa_neta || null });
export function progresoOperacion(detalle: DetalleOperacionComercial): { titulo: string; paso: number; siguiente: string; cerrada: boolean } {
  if (detalle.cancelada_en_cadena) return { titulo: 'Reserva cancelada', paso: 0, siguiente: 'Puede publicar o negociar otra operación', cerrada: true };
  const { operacion, cadena, venta_comercial: venta, liquidacion } = detalle;
  if (liquidacion?.orden_id === operacion.orden_id) return { titulo: liquidacion.reembolsada ? 'Reembolsada' : 'Venta completada', paso: 3, siguiente: 'Ver liquidación final', cerrada: true };
  if (venta?.orden_id !== operacion.orden_id) return { titulo: new Date(operacion.vence).getTime() < Date.now() ? 'Acuerdo vencido' : 'Acuerdo pendiente', paso: 0, siguiente: 'Confirmar la reserva del lote', cerrada: false };
  if (cadena?.estado === 'EnDisputa') return { titulo: 'Incidencia en revisión', paso: 2, siguiente: 'Revisar la incidencia y sus respaldos', cerrada: false };
  if (cadena?.estado === 'EnVenta') return { titulo: 'Esperando el pago', paso: 1, siguiente: 'El comprador deposita el total acordado', cerrada: false };
  if (cadena?.estado === 'EnGarantia') return venta.recepcion ? { titulo: 'Entrega registrada', paso: 2, siguiente: 'Revisar el lote y confirmar la compra', cerrada: false } : { titulo: 'Pago recibido', paso: 2, siguiente: 'Entregar el lote y registrar su recepción', cerrada: false };
  return { titulo: 'Consultar estado del lote', paso: 0, siguiente: 'Actualizar el estado antes de continuar', cerrada: false };
}
interface SesionComercial { cuenta: string | null; perfil: PerfilComercial | null }
interface EstadoSesion extends SesionComercial {
  cargando: boolean; ocupado: boolean; error: string | null; iniciar: () => Promise<void>; recargar: () => Promise<void>; salir: () => Promise<void>;
}
const Contexto = createContext<EstadoSesion | null>(null);
export const mensajeError = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la solicitud. Inténtelo de nuevo.';
export const pedirComercio = <T,>(ruta: string, opciones: { metodo?: string; json?: unknown } = {}) =>
  api<T>(`/comercio${ruta}`, { ...opciones, notificarSesion: false }).catch((error: unknown) => {
    if (error instanceof ErrorApi && error.estado === 401) window.dispatchEvent(new Event('sesion-comercial-vencida'));
    throw error;
  });

export function ProveedorComercio({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const [sesion, setSesion] = useState<SesionComercial>({ cuenta: null, perfil: null });
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recargar = useCallback(async () => {
    const respuesta = await pedirComercio<SesionComercial>('/sesion');
    setSesion(respuesta);
  }, []);
  useEffect(() => { void recargar().catch(() => {}).finally(() => setCargando(false)); }, [recargar]);
  useEffect(() => {
    const actualizar = () => { void recargar().catch(() => setSesion({ cuenta: null, perfil: null })); };
    window.addEventListener('sesion-comercial-vencida', actualizar);
    return () => window.removeEventListener('sesion-comercial-vencida', actualizar);
  }, [recargar]);
  const iniciar = async () => {
    setOcupado(true); setError(null);
    try {
      if (!navigator.onLine) throw new Error('Necesita conexión para iniciar sesión. Puede guardar un borrador mientras tanto.');
      const cuenta = wallet.direccion ?? await wallet.conectar();
      if (!cuenta) return;
      if (sesion.cuenta === cuenta) return;
      const desafio = await pedirComercio<{ id: string; mensaje: string }>('/sesion/desafio', { json: { cuenta } });
      const firma = await wallet.firmarMensaje(desafio.mensaje, cuenta);
      setSesion(await pedirComercio<SesionComercial>('/sesion/verificar', { json: { id: desafio.id, firma } }));
    } catch (e) { setError(mensajeError(e)); }
    finally { setOcupado(false); }
  };
  const salir = async () => {
    setOcupado(true); setError(null);
    try { await pedirComercio('/sesion/salir', { json: {} }); setSesion({ cuenta: null, perfil: null }); }
    catch (e) { setError(mensajeError(e)); }
    finally { setOcupado(false); }
  };
  // Una sesión de otra cuenta nunca autoriza acciones de la wallet actual.
  const coincide = !wallet.direccion || sesion.cuenta === wallet.direccion;
  return <Contexto.Provider value={{ cuenta: coincide ? sesion.cuenta : null, perfil: coincide ? sesion.perfil : null, cargando, ocupado, error, iniciar, recargar, salir }}>{children}</Contexto.Provider>;
}
export function useComercio() {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error('useComercio debe usarse dentro de ProveedorComercio');
  return contexto;
}
export function useConsultaComercial<T>(ruta: string | null) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(!!ruta);
  const [version, setVersion] = useState(0);
  const recargar = useCallback(() => setVersion((valor) => valor + 1), []);
  useEffect(() => {
    let vigente = true;
    setDatos(null); setError(null); setCargando(!!ruta);
    if (!ruta) return;
    void pedirComercio<T>(ruta).then((respuesta) => { if (vigente) setDatos(respuesta); })
      .catch((e) => { if (vigente) setError(mensajeError(e)); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, [ruta, version]);
  return { datos, error, cargando, recargar };
}
export function useConexion() {
  const [conectado, setConectado] = useState(navigator.onLine);
  useEffect(() => {
    const actualizar = () => setConectado(navigator.onLine);
    window.addEventListener('online', actualizar); window.addEventListener('offline', actualizar);
    return () => { window.removeEventListener('online', actualizar); window.removeEventListener('offline', actualizar); };
  }, []);
  return conectado;
}
export const fechaComercial = (fecha: string) => {
  const valor = new Date(fecha);
  return Number.isNaN(valor.getTime()) ? 'Fecha no disponible' : valor.toLocaleString('es-BO', { dateStyle: 'medium', timeStyle: 'short' });
};
export function dinero(importe: string | number | null | undefined, simbolo = '') {
  if (importe === null || importe === undefined || importe === '') return '—';
  const texto = String(importe).replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/.test(texto)) return '—';
  const negativo = texto.startsWith('-'); const [entero, fraccion = ''] = texto.replace(/^-/, '').split('.');
  const parteDecimal = fraccion.replace(/0+$/, '');
  return `${negativo ? '−' : ''}${BigInt(entero).toLocaleString('es-BO')}${parteDecimal ? `,${parteDecimal}` : ''}${simbolo ? ` ${simbolo}` : ''}`;
}
export function unidadesHumanas(importe: string, decimales: number): bigint {
  const texto = importe.trim().replace(',', '.');
  if (!(decimales === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${decimales}})?$`)).test(texto)) return 0n;
  const [entero, fraccion = ''] = texto.split('.');
  return BigInt(entero) * 10n ** BigInt(decimales) + BigInt(fraccion.padEnd(decimales, '0') || '0');
}
export function importeHumano(unidades: bigint, decimales: number): string {
  const signo = unidades < 0n ? '-' : ''; const valor = unidades < 0n ? -unidades : unidades;
  const base = 10n ** BigInt(decimales);
  const fraccion = decimales ? (valor % base).toString().padStart(decimales, '0').replace(/0+$/, '') : '';
  return `${signo}${valor / base}${fraccion ? `.${fraccion}` : ''}`;
}
export function resumenImportes(anuncio: EntradaAnuncio, token: InfoToken, politica?: PoliticaComercial | null) {
  const precio = unidadesHumanas(anuncio.precio, token.decimales);
  const neto = precio - unidadesHumanas(anuncio.gastos_ensayo || '0', token.decimales) - unidadesHumanas(anuncio.gastos_traslado || '0', token.decimales);
  const porcentaje = politica ? (precio * BigInt(politica.comision_bps) + 9999n) / 10000n : null;
  const minimo = politica ? unidadesHumanas(politica.comision_minima, token.decimales) : 0n;
  const comision = porcentaje === null ? null : porcentaje > minimo ? porcentaje : minimo;
  return { neto: importeHumano(neto, token.decimales), total: comision === null ? null : importeHumano(precio + comision, token.decimales) };
}
export function montoUnidades(importe: string | null | undefined, token: InfoToken) {
  if (!importe || !/^\d+$/.test(importe)) return '—';
  const valor = BigInt(importe); const base = 10n ** BigInt(token.decimales);
  const fraccion = (valor % base).toString().padStart(token.decimales, '0').replace(/0+$/, '');
  return `${(valor / base).toLocaleString('es-BO')}${fraccion ? `,${fraccion}` : ''} ${token.simbolo}`;
}
export function useCotizacion(precio: string, gastosEnsayo = '0', gastosTraslado = '0', ofertaExterna = '') {
  const conectado = useConexion();
  const [datos, setDatos] = useState<CotizacionComercial | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vigente = true; setDatos(null); setError(null);
    if (!/^\d+(\.\d+)?$/.test(precio) || !/[1-9]/.test(precio)) return;
    if (!conectado) { setError('Sin conexión para actualizar los importes.'); return; }
    const tiempo = setTimeout(() => {
      void pedirComercio<CotizacionComercial>('/cotizar', { json: { precio, gastos_ensayo: gastosEnsayo || '0', gastos_traslado: gastosTraslado || '0', oferta_externa_neta: ofertaExterna || undefined } })
        .then((respuesta) => { if (vigente) setDatos(respuesta); }).catch((e) => { if (vigente) setError(mensajeError(e)); });
    }, 300);
    return () => { vigente = false; clearTimeout(tiempo); };
  }, [precio, gastosEnsayo, gastosTraslado, ofertaExterna, conectado]);
  return { datos, error };
}

export interface BorradorComercial { id: string; datos: EntradaAnuncio; actualizado_en: string }
const CLAVE_BORRADORES = 'minertrace.comercio.borradores.v1';
function leerBorradores(): BorradorComercial[] {
  try { const guardados: unknown = JSON.parse(localStorage.getItem(CLAVE_BORRADORES) ?? '[]'); return Array.isArray(guardados) ? guardados.filter((valor) => typeof valor?.id === 'string' && valor.datos && typeof valor.datos.tipo === 'string') : []; }
  catch { return []; }
}
export function useBorradores() {
  const [borradores, setBorradores] = useState(leerBorradores);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const actualizar = () => setBorradores(leerBorradores());
    window.addEventListener('storage', actualizar); window.addEventListener('borradores-comercio', actualizar);
    return () => { window.removeEventListener('storage', actualizar); window.removeEventListener('borradores-comercio', actualizar); };
  }, []);
  const escribir = (valores: BorradorComercial[]) => {
    try { localStorage.setItem(CLAVE_BORRADORES, JSON.stringify(valores)); setBorradores(valores); setError(null); window.dispatchEvent(new Event('borradores-comercio')); return true; }
    catch { setError('El navegador no permitió guardar el borrador. Mantenga esta página abierta para no perderlo.'); return false; }
  };
  const guardar = (borrador: BorradorComercial) => escribir([...leerBorradores().filter((valor) => valor.id !== borrador.id), borrador]);
  const quitar = (id: string) => escribir(leerBorradores().filter((valor) => valor.id !== id));
  return { borradores, guardar, quitar, error };
}
export const erroresCampos = (error: unknown): Record<string, string> => error instanceof ErrorApi ? error.errores : {};
