# Preparación para producción

El arranque con `NODE_ENV=production` no crea laboratorios ni usuarios de demostración.
Los usuarios reales deben aprovisionarse antes de habilitar el acceso. Si la base ya
contiene cuentas demo, deshabilítelas o cambie sus credenciales antes de exponerla.
No borre los registros de integridad para limpiar una instalación.

- Configure un `JWT_SECRET` aleatorio de al menos 32 caracteres y HTTPS en el proxy.
- Mantenga `FIRMA_LABORATORIO=wallet`; el portal exige la firma del laboratorio.
- El contrato y las wallets actuales trabajan en Stellar **testnet**. El despliegue
  web en producción no convierte el marketplace en una solución de dinero real.
- El límite de acceso es local: 20 intentos por IP cada 15 minutos. Con varias
  instancias, añada un límite compartido en el proxy. No se confía en
  `X-Forwarded-For`: detrás de un proxy el límite se comparte entre sus usuarios;
  ajuste la infraestructura antes de abrir acceso a muchos laboratorios.
- Verifique restauración de copias de la base y los PDF, monitoreo y alertas.
- Ejecute `npm run typecheck`, `npm test`, `npm run build` y las pruebas de
  testnet con las cuentas del entorno de destino.
- Pruebe en navegador móvil y escritorio: iniciar sesión, registrar lote y PDF,
  conectar Freighter, firmar, retomar una firma cancelada y escanear QR.
  Compruebe también las cabeceras CSP con la extensión instalada.

## Próximas mejoras sugeridas

1. Administración de usuarios reales, recuperación de acceso y revocación de sesiones.
2. Sesiones con cookies HttpOnly y protección CSRF; actualmente se usa un token en localStorage.
3. Alertas de firmas pendientes y vencimiento de garantías.
4. Importación de resultados desde equipos o archivos, con revisión antes de sellar.
5. Seguimiento de muestras desde recepción hasta entrega del certificado.

Referencia para autenticación y límites:
https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
