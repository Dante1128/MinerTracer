import { Navigate, Outlet, useLocation } from 'react-router';
import { useSesion } from '../sesion.tsx';

export function RutaProtegida() {
  const { usuario, cargando } = useSesion();
  const { pathname } = useLocation();
  if (cargando) return <p className="py-16 text-center text-stone-500">Cargando…</p>;
  if (!usuario) return <Navigate to="/laboratorio/login" state={{ desde: pathname }} replace />;
  return <Outlet />;
}
