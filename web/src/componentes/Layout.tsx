import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useState } from 'react';
import { anclajeReal, useInfoServidor } from '../infoServidor.ts';
import { BotonWallet } from './Mercado.tsx';
import { useSesion } from '../sesion.tsx';

export function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return <img src="/favicon.svg" alt="" className={className} />;
}

const enlace = ({ isActive }: { isActive: boolean }) =>
  `shrink-0 rounded-lg px-1.5 py-2 text-xs font-medium whitespace-nowrap transition sm:px-3 sm:text-sm ${isActive ? 'bg-stone-800 text-white' : 'text-stone-300 hover:text-white'}`;

const enlacePortal = ({ isActive }: { isActive: boolean }) =>
  `shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition ${isActive ? 'border-mineral-500 text-stone-900' : 'border-transparent text-stone-600 hover:text-stone-900'}`;

export function Layout() {
  const { usuario, salir } = useSesion();
  const ubicacion = useLocation();
  const navegar = useNavigate();
  const [errorSalida, setErrorSalida] = useState<string | null>(null);
  const [saliendo, setSaliendo] = useState(false);
  const cerrar = async () => {
    setSaliendo(true);
    setErrorSalida(null);
    try { await salir(); }
    catch { setErrorSalida('No se pudo cerrar la sesión. Compruebe la conexión y vuelva a intentarlo.'); }
    finally { setSaliendo(false); }
  };
  const info = useInfoServidor();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-stone-900 print:hidden">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3" aria-label="Navegación principal">
          <Link to="/" className="flex shrink-0 items-center gap-2 text-lg font-bold tracking-tight text-white">
            <Logo />
            <span>MinerTrace</span>
          </Link>
          {anclajeReal(info) && <span className="ml-auto sm:order-last"><BotonWallet /></span>}
          <div className="w-full min-w-0 sm:ml-auto sm:w-auto">
            <div className="grid grid-cols-4 items-center gap-1 border-t border-stone-800 pt-2 text-center sm:flex sm:border-0 sm:pt-0">
              <NavLink to="/verificar" className={enlace}>
                Verificar
              </NavLink>
              <NavLink to="/comercio" className={enlace}>
                <span className="sm:hidden">Mercado</span><span className="hidden sm:inline">Comprar y vender</span>
              </NavLink>
              <NavLink to="/operaciones" className={enlace}>
                Operaciones
              </NavLink>
              <NavLink to="/laboratorio" className={enlace}>
                Laboratorio
              </NavLink>
            </div>
          </div>
        </nav>
      </header>

      {/* Portal del laboratorio: visible en todas las páginas mientras hay sesión. */}
      {usuario && (
        <div className="border-b border-stone-200 bg-white print:hidden">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4">
            <div className="min-w-0 flex-1 py-2 sm:hidden">
              <label className="sr-only" htmlFor="navegacion-laboratorio">Secciones del laboratorio</label>
              <select id="navegacion-laboratorio" className="campo" value={ubicacion.pathname.startsWith('/laboratorio/analisis/') ? '/laboratorio' : ubicacion.pathname.startsWith('/laboratorio') ? ubicacion.pathname : ''} onChange={(evento) => { if (evento.target.value) navegar(evento.target.value); }}>
                <option value="">Ir al laboratorio…</option><option value="/laboratorio">Panel de análisis</option><option value="/laboratorio/nuevo">Registrar análisis</option><option value="/laboratorio/contra-analisis">Contraanálisis</option><option value="/laboratorio/comercio">Entregas y ensayos</option><option value="/laboratorio/cuenta">Mi cuenta</option>{usuario.rol === 'supervisor' && <option value="/laboratorio/usuarios">Usuarios</option>}
              </select>
            </div>
            <div className="hidden min-w-0 items-center overflow-x-auto sm:flex">
              <NavLink to="/laboratorio" end className={enlacePortal}>
                Panel
              </NavLink>
              <NavLink to="/laboratorio/nuevo" className={enlacePortal}>
                Registrar análisis
              </NavLink>
              <NavLink to="/laboratorio/contra-analisis" className={enlacePortal}>
                Contra-análisis
              </NavLink>
              <NavLink to="/laboratorio/comercio" className={enlacePortal}>Entregas y ensayos</NavLink>
              <NavLink to="/laboratorio/cuenta" className={enlacePortal}>Mi cuenta</NavLink>
              {usuario.rol === 'supervisor' && <NavLink to="/laboratorio/usuarios" className={enlacePortal}>Usuarios</NavLink>}
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs text-stone-500">
              <span className="hidden md:inline" title={usuario.email}>
                {usuario.nombre} · {usuario.rol} · {usuario.laboratorio_id}
              </span>
              <button onClick={() => void cerrar()} disabled={saliendo} className="rounded-lg px-2 py-1 font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900">
                {saliendo ? 'Saliendo…' : 'Salir'}
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1">
        {errorSalida && <p role="alert" className="mx-auto max-w-6xl p-4 text-sm text-red-700">{errorSalida}</p>}
        <Outlet />
      </main>
      <footer className="border-t border-stone-200 py-6 text-center text-xs text-stone-500 print:hidden">
        MinerTrace · Acuerdos claros, origen documentado ·{' '}
        {info === null ? 'Prototipo' : anclajeReal(info) ? `Anclado en Stellar ${info.red}` : 'Prototipo (anclaje simulado)'}
        <div className="mt-3 flex flex-wrap justify-center gap-5"><Link to="/mercado" className="hover:text-stone-900">Lotes certificados</Link><Link to="/mis-lotes" className="hover:text-stone-900">Mis lotes</Link><Link to="/verificar" className="hover:text-stone-900">Verificar un informe</Link></div>
      </footer>
    </div>
  );
}
