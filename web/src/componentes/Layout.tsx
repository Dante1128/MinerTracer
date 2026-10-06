import { Link, NavLink, Outlet } from 'react-router';
import { anclajeReal, useInfoServidor } from '../infoServidor.ts';
import { BotonWallet } from './Mercado.tsx';
import { useSesion } from '../sesion.tsx';

export function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return <img src="/favicon.svg" alt="" className={className} />;
}

const enlace = ({ isActive }: { isActive: boolean }) =>
  `shrink-0 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition ${isActive ? 'bg-stone-800 text-white' : 'text-stone-300 hover:text-white'}`;

const enlacePortal = ({ isActive }: { isActive: boolean }) =>
  `shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition ${isActive ? 'border-mineral-500 text-stone-900' : 'border-transparent text-stone-600 hover:text-stone-900'}`;

export function Layout() {
  const { usuario, salir } = useSesion();
  const info = useInfoServidor();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-stone-900 print:hidden">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
          <Link to="/" className="flex shrink-0 items-center gap-2 text-lg font-bold tracking-tight text-white">
            <Logo />
            <span className="hidden sm:inline">MinerTrace</span>
          </Link>
          <div className="flex min-w-0 items-center gap-1">
            {/* En pantallas angostas los enlaces se desplazan en vez de romper la barra. */}
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
              <NavLink to="/verificar" className={enlace}>
                Verificar
              </NavLink>
              <NavLink to="/mercado" className={enlace}>
                Mercado
              </NavLink>
              <NavLink to="/mis-lotes" className={enlace}>
                Mis lotes
              </NavLink>
              <NavLink to="/laboratorio" className={enlace}>
                Laboratorio
              </NavLink>
            </div>
            {anclajeReal(info) && (
              <span className="ml-1 shrink-0">
                <BotonWallet />
              </span>
            )}
          </div>
        </nav>
      </header>

      {/* Portal del laboratorio: visible en todas las páginas mientras hay sesión. */}
      {usuario && (
        <div className="border-b border-stone-200 bg-white print:hidden">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4">
            <div className="flex min-w-0 items-center overflow-x-auto">
              <NavLink to="/laboratorio" end className={enlacePortal}>
                Panel
              </NavLink>
              <NavLink to="/laboratorio/nuevo" className={enlacePortal}>
                Registrar análisis
              </NavLink>
              <NavLink to="/laboratorio/contra-analisis" className={enlacePortal}>
                Contra-análisis
              </NavLink>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs text-stone-500">
              <span className="hidden md:inline" title={usuario.email}>
                {usuario.nombre} · {usuario.rol} · {usuario.laboratorio_id}
              </span>
              <button onClick={salir} className="rounded-lg px-2 py-1 font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900">
                Salir
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-stone-200 py-6 text-center text-xs text-stone-500 print:hidden">
        MinerTrace · Integridad verificable de análisis minerales ·{' '}
        {info === null ? 'Prototipo' : anclajeReal(info) ? `Anclado en Stellar ${info.red}` : 'Prototipo (anclaje simulado)'}
      </footer>
    </div>
  );
}
