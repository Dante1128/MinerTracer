import { useState, type FormEvent } from 'react';
import { api, ErrorApi } from '../api.ts';
import { useSesion } from '../sesion.tsx';

export function MiCuenta() {
  const { usuario, olvidar } = useSesion();
  const [actual, setActual] = useState('');
  const [password, setPassword] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  const ejecutar = async (ruta: string, datos: unknown) => {
    if (ocupado) return;
    setOcupado(true); setError('');
    try {
      await api(ruta, { json: datos });
      olvidar('Acceso actualizado. Inicie sesión de nuevo.');
    } catch (fallo) { setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo actualizar el acceso'); }
    finally { setOcupado(false); }
  };
  const cambiar = (evento: FormEvent) => {
    evento.preventDefault();
    if (password !== confirmacion) { setError('Las contraseñas no coinciden'); return; }
    void ejecutar('/auth/clave', { actual, password });
  };

  return <div className="mx-auto max-w-xl space-y-6 px-4 py-10">
    <div><h1 className="text-3xl font-bold">Mi cuenta</h1><p className="mt-2 text-stone-600">{usuario?.nombre} · {usuario?.email}</p></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <form className="tarjeta space-y-4 p-6" onSubmit={cambiar}>
      <h2 className="font-semibold">Cambiar contraseña</h2>
      <p className="text-sm text-stone-600">Use al menos 12 caracteres. Al cambiarla se cerrarán todas sus sesiones.</p>
      <label className="etiqueta" htmlFor="clave-actual">Contraseña actual</label>
      <input id="clave-actual" className="campo" type="password" autoComplete="current-password" value={actual} onChange={(e) => setActual(e.target.value)} required />
      <label className="etiqueta" htmlFor="clave-nueva">Nueva contraseña</label>
      <input id="clave-nueva" className="campo" type="password" autoComplete="new-password" minLength={12} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} required />
      <label className="etiqueta" htmlFor="clave-repetida">Repita la nueva contraseña</label>
      <input id="clave-repetida" className="campo" type="password" autoComplete="new-password" minLength={12} maxLength={72} value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} required />
      <button className="boton-primario" disabled={ocupado}>{ocupado ? 'Procesando…' : 'Guardar contraseña'}</button>
    </form>
    <section className="tarjeta space-y-3 p-6">
      <h2 className="font-semibold">Cerrar todas las sesiones</h2>
      <p className="text-sm text-stone-600">Cierra el acceso en este dispositivo y en los demás donde haya ingresado.</p>
      <button className="boton-secundario" disabled={ocupado} onClick={() => void ejecutar('/auth/sesiones/revocar', {})}>Cerrar todas las sesiones</button>
    </section>
  </div>;
}
