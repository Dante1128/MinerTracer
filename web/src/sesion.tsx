import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, onSesionExpirada, type RespuestaSesion, type Usuario } from './api.ts';

interface Sesion {
  usuario: Usuario | null;
  cargando: boolean;
  entrar: (email: string, password: string) => Promise<void>;
  salir: () => Promise<void>;
  olvidar: (mensaje?: string) => void;
  aviso: string;
}

const ContextoSesion = createContext<Sesion | null>(null);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState('');
  const revision = useRef(0);

  const olvidar = (mensaje = '') => {
    revision.current++;
    setUsuario(null);
    setAviso(mensaje);
    setCargando(false);
  };

  const salir = async () => {
    await api('/auth/salir', { json: {} });
    olvidar();
  };

  useEffect(() => {
    // Elimina las credenciales del portal anterior; la cookie HttpOnly es la única sesión.
    try { localStorage.removeItem('minertrace.token'); } catch { /* Almacenamiento no disponible. */ }
    onSesionExpirada(olvidar);
    let vigente = true;
    const iniciada = revision.current;
    api<{ usuario: Usuario }>('/auth/yo', { notificarSesion: false })
      .then((r) => { if (vigente && revision.current === iniciada) setUsuario(r.usuario); })
      .catch(() => { if (vigente && revision.current === iniciada) olvidar(); })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
  }, []);

  const entrar = async (email: string, password: string) => {
    const r = await api<RespuestaSesion>('/auth/login', { json: { email, password } });
    revision.current++;
    setUsuario(r.usuario);
    setAviso('');
    setCargando(false);
  };

  return <ContextoSesion.Provider value={{ usuario, cargando, entrar, salir, olvidar, aviso }}>{children}</ContextoSesion.Provider>;
}

export function useSesion(): Sesion {
  const sesion = useContext(ContextoSesion);
  if (!sesion) throw new Error('useSesion fuera de ProveedorSesion');
  return sesion;
}
