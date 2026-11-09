# Preparación para producción

El arranque con `NODE_ENV=production` no crea laboratorios ni usuarios de demostración.
Los usuarios reales se aprovisionan con `npm run cuenta:crear` y desde **Usuarios**.
Si la base ya contiene cuentas demo, deshabilítelas o cambie sus credenciales antes de exponerla.
No borre los registros de integridad para limpiar una instalación.

- Configure un `JWT_SECRET` aleatorio de al menos 32 caracteres y HTTPS en el proxy.
- Configure `ORIGEN_PUBLICO` con el origen HTTPS exacto, sin ruta ni barra final.
- Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USUARIO`, `SMTP_CLAVE`
  y `SMTP_REMITENTE`. En producción se exige TLS directo o STARTTLS para el correo.
- Mantenga `FIRMA_LABORATORIO=wallet`; el portal exige la firma del laboratorio.
- El contrato y las wallets actuales trabajan en Stellar **testnet**. El despliegue
  web en producción no convierte el marketplace en una solución de dinero real.
- Los límites son atómicos y se comparten en la base: 20 intentos por IP y por
  cuenta cada 15 minutos para ingresar; 5 para solicitar recuperación. Los ámbitos
  son independientes. Para varias instancias use el mismo PostgreSQL y el mismo
  `JWT_SECRET`. PGlite es para un solo proceso.
- Configure `PROXIES_CONFIABLES` solo con las IP o CIDR de sus proxies. Estos deben
  reemplazar `X-Forwarded-For` con la dirección real. Vacío significa no confiar en
  esa cabecera; detrás de un proxy todos compartirían el límite de su IP.
- Verifique restauración de copias de la base y los PDF, monitoreo y alertas.
- Ejecute `npm run typecheck`, `npm test`, `npm run build` y las pruebas de
  testnet con las cuentas del entorno de destino.
- Pruebe en navegador móvil y escritorio: iniciar sesión, registrar lote y PDF,
  conectar Freighter, firmar, retomar una firma cancelada y escanear QR.
  Compruebe también las cabeceras CSP con la extensión instalada.

## Cuentas y sesiones

Ejecute `npm run cuenta:crear` antes de iniciar la API si usa PGlite. El comando
solicita los datos públicos del laboratorio y del supervisor, crea la cuenta y
encola su invitación. Nunca imprime contraseñas ni enlaces. Con PostgreSQL puede
ejecutarse mientras la API está activa. El servidor procesa el correo cada 15
segundos. Crear un laboratorio en la base no lo autoriza en el contrato Stellar:
esa autorización corresponde al administrador del contrato.

El supervisor entra a **Usuarios** para invitar analistas o supervisores de su
laboratorio, cambiar permisos, habilitar o deshabilitar cuentas, cerrar sesiones
y reenviar enlaces. No puede deshabilitarse ni cambiar su propio rol. Deshabilitar
conserva la identidad y el historial de los análisis; nunca borra sus autores.

Todos tienen **Mi cuenta** para cambiar su contraseña o cerrar todas sus sesiones,
y **Olvidé mi contraseña** en el acceso. Cambiar la contraseña requiere la actual;
recuperarla requiere el enlace de correo. Las claves nuevas tienen al menos 12
caracteres y un máximo de 72 bytes, sin truncamiento de bcrypt.

Los enlaces vencen en 30 minutos, son de un solo uso y se invalidan al reenviarlos
o revocar el acceso. La base conserva solo el hash del secreto; el correo en cola
se cifra con AES-256-GCM usando una clave derivada de `JWT_SECRET`. Al entregar el
correo se elimina su contenido. Un fallo se reintenta hasta 5 veces, separado por
2 minutos; el registro identifica el correo y el intento sin exponer su contenido.
Revise las alertas `[correo]` si un usuario no recibe el mensaje; puede reenviar
desde **Usuarios** después de corregir SMTP. Cambiar `JWT_SECRET` invalida el
contenido de los correos pendientes: solicite enlaces nuevos tras rotarlo.

Las sesiones duran hasta 12 horas. Se identifican con una cookie HttpOnly,
SameSite=Strict y Secure en producción, con prefijo `__Host-`. El servidor guarda
solo el hash del identificador y verifica en cada petición que la cuenta siga
activa y que no haya sido revocada. Salir revoca la sesión actual; cambiar clave,
permisos o estado y cerrar todas las sesiones revoca el acceso correspondiente.
Las mutaciones de la API requieren un token CSRF vinculado a la cookie y al
origen del portal. El navegador lo obtiene automáticamente, sin pasos adicionales.
Los bearer anteriores dejan de aceptarse; el portal limpia el antiguo token de
localStorage al cargar. Los usuarios deberán iniciar sesión otra vez al actualizar.

Para probar correos en desarrollo use, por ejemplo, Mailpit: `SMTP_HOST=127.0.0.1`,
`SMTP_PORT=1025`, `SMTP_SECURE=false`, `SMTP_REMITENTE=MinerTrace <acceso@minertrace.test>`.
Abra su bandeja local y complete la invitación. Antes de publicar valide también
la entrega con su proveedor SMTP real.

## Próximas mejoras sugeridas

1. Alertas de firmas pendientes y vencimiento de garantías.
2. Importación de resultados desde equipos o archivos, con revisión antes de sellar.
3. Seguimiento de muestras desde recepción hasta entrega del certificado.

Referencia para autenticación y límites:
https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
