import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ErrorApi } from '../api.ts';
import { Logo } from '../componentes/Layout.tsx';
import { useSesion } from '../sesion.tsx';

export function Login() {
  const { usuario, entrar } = useSesion();
  const destino = (useLocation().state as { desde?: string } | null)?.desde ?? '/laboratorio';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (usuario) return <Navigate to={destino} replace />;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await entrar(email, password);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo iniciar sesión');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <div className="mb-8 text-center">
        <Logo className="mx-auto h-12 w-12" />
        <h1 className="mt-4 text-2xl font-bold">Portal del laboratorio</h1>
        <p className="text-sm text-stone-600">Acceso para analistas y supervisores</p>
      </div>
      <form onSubmit={enviar} className="tarjeta space-y-4 p-6">
        <div>
          <label className="etiqueta" htmlFor="email">
            Correo
          </label>
          <input id="email" type="email" autoComplete="username" className="campo" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="etiqueta" htmlFor="password">
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className="campo"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        <button className="boton-primario w-full" disabled={enviando}>
          {enviando ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
      {import.meta.env.DEV && (
        <div className="mt-4 rounded-lg bg-mineral-50 p-3 text-xs text-stone-700">
          <p className="font-semibold">Usuarios de prueba (contraseña: minertrace123)</p>
          <p>analista@lab001.test · supervisor@lab001.test</p>
        </div>
      )}
    </div>
  );
}
