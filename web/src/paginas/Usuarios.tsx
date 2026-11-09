import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { api, ErrorApi, type RespuestaCuenta, type UsuarioGestionado } from '../api.ts';
import { useSesion } from '../sesion.tsx';

export function Usuarios() {
  const { usuario } = useSesion();
  const [usuarios, setUsuarios] = useState<UsuarioGestionado[] | null>(null);
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState('analista');
  const [roles, setRoles] = useState<Record<number, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const cargar = useCallback(async () => { setUsuarios(await api<UsuarioGestionado[]>('/usuarios')); }, []);
  useEffect(() => {
    if (usuario?.rol === 'supervisor') void cargar().catch((fallo: unknown) => setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudieron cargar los usuarios'));
  }, [cargar, usuario?.rol]);

  if (usuario?.rol !== 'supervisor') return <Navigate to="/laboratorio" replace />;

  const accion = async (id: number, tipo: string, datos: unknown = {}) => {
    if (ocupado) return;
    setOcupado(true); setError(''); setMensaje('');
    try {
      const respuesta = await api<RespuestaCuenta>(`/usuarios/${id}/${tipo}`, { json: datos });
      setMensaje(respuesta.mensaje);
      setRoles({});
      await cargar();
    } catch (fallo) { setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo actualizar el usuario'); }
    finally { setOcupado(false); }
  };
  const crear = async (evento: FormEvent) => {
    evento.preventDefault();
    if (ocupado) return;
    setOcupado(true); setError(''); setMensaje('');
    try {
      await api<UsuarioGestionado>('/usuarios', { json: { nombre, email, rol } });
      setNombre(''); setEmail(''); setRol('analista');
      setMensaje('Usuario creado. Recibirá un enlace por correo para elegir su contraseña.');
      await cargar();
    } catch (fallo) { setError(fallo instanceof ErrorApi ? `${fallo.message}${Object.values(fallo.errores).length ? ': ' + Object.values(fallo.errores).join('. ') : ''}` : 'No se pudo crear el usuario'); }
    finally { setOcupado(false); }
  };

  return <div className="mx-auto max-w-4xl space-y-6 px-4 py-10">
    <div><h1 className="text-3xl font-bold">Usuarios del laboratorio</h1><p className="mt-2 text-stone-600">Invite a su equipo y controle quién puede acceder.</p></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {mensaje && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{mensaje}</p>}
    <form onSubmit={crear} className="tarjeta space-y-4 p-6">
      <h2 className="font-semibold">Invitar usuario</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="etiqueta" htmlFor="nombre-usuario">Nombre</label><input id="nombre-usuario" className="campo" autoComplete="name" maxLength={120} value={nombre} onChange={(e) => setNombre(e.target.value)} required /></div>
        <div><label className="etiqueta" htmlFor="correo-usuario">Correo</label><input id="correo-usuario" className="campo" type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
      </div>
      <label className="etiqueta" htmlFor="rol-usuario">Permisos</label>
      <select id="rol-usuario" className="campo" value={rol} onChange={(e) => setRol(e.target.value)}><option value="analista">Analista</option><option value="supervisor">Supervisor</option></select>
      <p className="text-xs text-stone-500">El supervisor también administra usuarios y registra correcciones.</p>
      <button className="boton-primario" disabled={ocupado}>{ocupado ? 'Procesando…' : 'Crear y enviar invitación'}</button>
    </form>
    <section className="space-y-3">
      <h2 className="font-semibold">Equipo</h2>
      {usuarios === null && <p className="text-sm text-stone-500">{error ? 'No se pudo cargar el equipo.' : 'Cargando…'}</p>}
      {error && <button className="boton-secundario" disabled={ocupado} onClick={() => void cargar().then(() => setError('')).catch(() => setError('No se pudieron cargar los usuarios'))}>Recargar equipo</button>}
      {usuarios?.map((persona) => <article key={persona.id} className="tarjeta space-y-3 p-5">
        <div><h3 className="font-semibold">{persona.nombre}{persona.id === usuario.id ? ' (usted)' : ''}</h3><p className="break-all text-sm text-stone-600">{persona.email}</p><p className="text-xs text-stone-500">{persona.activo ? 'Habilitado' : 'Deshabilitado'} · {persona.rol}</p></div>
        {persona.id !== usuario.id && <div className="flex flex-wrap items-center gap-2">
          <select className="campo w-auto" aria-label={`Permisos de ${persona.nombre}`} value={roles[persona.id] ?? persona.rol} disabled={ocupado} onChange={(e) => setRoles({ ...roles, [persona.id]: e.target.value })}><option value="analista">Analista</option><option value="supervisor">Supervisor</option></select>
          {roles[persona.id] && roles[persona.id] !== persona.rol && <button className="boton-primario" disabled={ocupado} onClick={() => void accion(persona.id, 'rol', { rol: roles[persona.id] })}>Guardar permisos</button>}
          <button className="boton-secundario" disabled={ocupado} onClick={() => void accion(persona.id, 'estado', { activo: !persona.activo })}>{persona.activo ? 'Deshabilitar' : 'Habilitar'}</button>
          {persona.activo && <><button className="boton-secundario" disabled={ocupado} onClick={() => void accion(persona.id, 'revocar')}>Cerrar sesiones</button><button className="boton-secundario" disabled={ocupado} onClick={() => void accion(persona.id, 'invitacion')}>Enviar enlace de acceso</button></>}
        </div>}
      </article>)}
    </section>
  </div>;
}
