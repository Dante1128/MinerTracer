import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, onSesionExpirada, token, type Usuario } from './api.ts';

interface Sesion {
  usuario: Usuario | null;
  cargando: boolean;
  entrar: (email: string, password: string) => Promise<void>;
  salir: () => void;
}

const ContextoSesion = createContext<Sesion | null>(null);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(() => token.leer() !== null);

  const salir = () => {
    token.guardar(null);
    setUsuario(null);
  };

  useEffect(() => {
    onSesionExpirada(salir);
    if (!token.leer()) return;
    api<{ usuario: Usuario }>('/auth/yo')
      .then((r) => setUsuario(r.usuario))
      .catch(salir)
      .finally(() => setCargando(false));
  }, []);

  const entrar = async (email: string, password: string) => {
    const r = await api<{ token: string; usuario: Usuario }>('/auth/login', { json: { email, password } });
    token.guardar(r.token);
    setUsuario(r.usuario);
  };

  return <ContextoSesion.Provider value={{ usuario, cargando, entrar, salir }}>{children}</ContextoSesion.Provider>;
}

export function useSesion(): Sesion {
  const sesion = useContext(ContextoSesion);
  if (!sesion) throw new Error('useSesion fuera de ProveedorSesion');
  return sesion;
}
