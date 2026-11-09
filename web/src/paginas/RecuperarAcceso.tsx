import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ErrorApi, type RespuestaCuenta } from '../api.ts';
import { useSesion } from '../sesion.tsx';

export function RecuperarAcceso() {
  const { olvidar } = useSesion();
  const [secreto] = useState(() => window.location.hash.slice(1));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [terminado, setTerminado] = useState(false);

  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    if (ocupado) return;
    setError('');
    if (secreto && password !== confirmacion) { setError('Las contraseñas no coinciden'); return; }
    setOcupado(true);
    try {
      const respuesta = await api<RespuestaCuenta>(secreto ? '/auth/restablecer' : '/auth/recuperar', {
        json: secreto ? { secreto, password } : { email },
      });
      if (secreto) olvidar();
      setPassword(''); setConfirmacion('');
      setMensaje(respuesta.mensaje);
      setTerminado(true);
    } catch (fallo) { setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo completar la solicitud'); }
    finally { setOcupado(false); }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="text-2xl font-bold">{secreto ? 'Elija su contraseña' : 'Recuperar acceso'}</h1>
      <p className="mt-2 text-sm text-stone-600">{secreto ? 'Use al menos 12 caracteres. El enlace vence en 30 minutos y se usa una sola vez.' : 'Ingrese su correo. Le enviaremos un enlace para elegir una nueva contraseña.'}</p>
      {terminado ? <p role="status" className="tarjeta mt-6 p-5 text-emerald-800">{mensaje}</p> : (
        <form className="tarjeta mt-6 space-y-4 p-6" onSubmit={enviar}>
          {secreto ? <>
            <label className="etiqueta" htmlFor="nueva-clave">Nueva contraseña</label>
            <input id="nueva-clave" className="campo" type="password" autoComplete="new-password" minLength={12} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} required />
            <label className="etiqueta" htmlFor="confirmar-clave">Repita la contraseña</label>
            <input id="confirmar-clave" className="campo" type="password" autoComplete="new-password" minLength={12} maxLength={72} value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} required />
          </> : <>
            <label className="etiqueta" htmlFor="correo-recuperacion">Correo</label>
            <input id="correo-recuperacion" className="campo" type="email" autoComplete="username" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} required />
          </>}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <button className="boton-primario w-full" disabled={ocupado}>{ocupado ? 'Procesando…' : secreto ? 'Guardar contraseña' : 'Enviar enlace'}</button>
          {secreto && error && <Link className="block text-sm text-mineral-700 hover:underline" reloadDocument to="/laboratorio/recuperar">Solicitar otro enlace</Link>}
        </form>
      )}
      <Link className="mt-6 inline-block text-sm text-mineral-700 hover:underline" to="/laboratorio/login">Volver al acceso</Link>
    </div>
  );
}
