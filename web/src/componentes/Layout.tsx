import { Link, NavLink, Outlet } from 'react-router';
import { anclajeReal, useInfoServidor } from '../infoServidor.ts';
import { useSesion } from '../sesion.tsx';

export function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return <img src="/favicon.svg" alt="" className={className} />;
}

const enlace = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-stone-800 text-white' : 'text-stone-300 hover:text-white'}`;

export function Layout() {
  const { usuario, salir } = useSesion();
  const info = useInfoServidor();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-stone-900 print:hidden">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-lg font-bold tracking-tight text-white">
            <Logo />
            <span className="hidden sm:inline">MinerTrace</span>
          </Link>
          <div className="flex items-center gap-1">
            <NavLink to="/verificar" className={enlace}>
              Verificar
            </NavLink>
            <NavLink to="/laboratorio" className={enlace}>
              Laboratorio
            </NavLink>
            {usuario && (
              <button onClick={salir} className="ml-1 rounded-lg px-3 py-2 text-sm text-stone-400 hover:text-white" title={usuario.email}>
                Salir
              </button>
            )}
          </div>
        </nav>
      </header>
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
