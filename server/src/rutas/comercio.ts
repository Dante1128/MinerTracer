import { Router } from 'express';
import { requiereSesion, usuarioDe } from '../auth.ts';
import { ErrorHttp, type Contexto } from '../contexto.ts';
import { cotizar, leerPolitica } from '../comercio/politica.ts';
import { cerrarSesionComercial, crearDesafio, cuentaComercialDe, leerSesionComercial, requiereSesionComercial, verificarDesafio } from '../comercio/sesion.ts';
import { aceptarOferta, agregarEvidencia, agregarEvidenciaLaboratorio, cerrarAnuncio, contraofertar, crearAnuncio, crearOferta,
  detalleAnuncio, expedienteLote, guardarPerfil, listarAnuncios, listarOperaciones, obtenerOperacion, obtenerPerfil,
  operacionesLaboratorio, rechazarOferta, resumenComercial } from '../comercio/servicio.ts';
import { limitarAcceso } from '../seguridad.ts';

const cuerpoDe = (valor: unknown): Record<string, unknown> => {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new ErrorHttp(400, 'Envíe un objeto JSON');
  return valor as Record<string, unknown>;
};

export function rutasComercio(ctx: Contexto) {
  const r = Router();
  r.get('/politica', async (_req, res) => res.json(await leerPolitica(ctx)));
  r.post('/cotizar', limitarAcceso(ctx.db, 'comercio-cotizar', 120), async (req, res) => {
    const entrada = cuerpoDe(req.body);
    res.json(cotizar(await leerPolitica(ctx), { precio: entrada.precio, gastos_ensayo: entrada.gastos_ensayo,
      gastos_traslado: entrada.gastos_traslado, oferta_externa_neta: entrada.oferta_externa_neta }));
  });
  r.post('/sesion/desafio', limitarAcceso(ctx.db, 'comercio-desafio', 20), async (req, res) => {
    res.json(await crearDesafio(ctx.db, cuerpoDe(req.body).cuenta, req, res));
  });
  r.post('/sesion/verificar', limitarAcceso(ctx.db, 'comercio-firma', 20), async (req, res) => {
    const resultado = await verificarDesafio(ctx.db, cuerpoDe(req.body), req, res);
    res.json({ ...resultado, perfil: await obtenerPerfil(ctx.db, resultado.cuenta) });
  });
  r.get('/sesion', async (req, res) => {
    const cuenta = await leerSesionComercial(ctx.db, req);
    res.json({ cuenta, perfil: cuenta ? await obtenerPerfil(ctx.db, cuenta) : null });
  });
  r.post('/sesion/salir', async (req, res) => res.json(await cerrarSesionComercial(ctx.db, req, res)));
  r.get('/anuncios', async (req, res) => res.json({ anuncios: await listarAnuncios(ctx, req.query, await leerSesionComercial(ctx.db, req)) }));
  r.get('/anuncios/:id', async (req, res) => res.json(await detalleAnuncio(ctx, String(req.params.id), await leerSesionComercial(ctx.db, req))));
  r.get('/lotes/:id/expediente', async (req, res) => res.json(await expedienteLote(ctx, String(req.params.id))));
  r.get('/lotes/:id/expediente.json', async (req, res) => {
    const expediente = await expedienteLote(ctx, String(req.params.id));
    res.type('application/json').attachment(`${expediente.verificacion.lote.id}-expediente.json`).send(JSON.stringify(expediente, null, 2));
  });
  r.get('/laboratorio/operaciones', requiereSesion(ctx.db), async (req, res) => {
    res.json(await operacionesLaboratorio(ctx, usuarioDe(req).laboratorio_id));
  });
  r.post('/laboratorio/operaciones/:id/evidencias', requiereSesion(ctx.db), limitarAcceso(ctx.db, 'comercio-evidencia-lab', 100), async (req, res) => {
    res.status(201).json(await agregarEvidenciaLaboratorio(ctx, String(req.params.id), usuarioDe(req).laboratorio_id, cuerpoDe(req.body)));
  });

  r.use(requiereSesionComercial(ctx.db));
  r.get('/perfil', async (req, res) => res.json(await obtenerPerfil(ctx.db, cuentaComercialDe(req))));
  r.put('/perfil', limitarAcceso(ctx.db, 'comercio-perfil', 40), async (req, res) => res.json(await guardarPerfil(ctx.db, cuentaComercialDe(req), cuerpoDe(req.body))));
  r.post('/anuncios', limitarAcceso(ctx.db, 'comercio-anuncio', 40), async (req, res) => res.status(201).json(await crearAnuncio(ctx, cuentaComercialDe(req), cuerpoDe(req.body))));
  r.post('/anuncios/:id/cerrar', async (req, res) => res.json(await cerrarAnuncio(ctx, String(req.params.id), cuentaComercialDe(req))));
  r.post('/anuncios/:id/ofertas', limitarAcceso(ctx.db, 'comercio-oferta', 100), async (req, res) => res.status(201).json(await crearOferta(ctx, String(req.params.id), cuentaComercialDe(req), cuerpoDe(req.body))));
  r.post('/ofertas/:id/contraofertar', limitarAcceso(ctx.db, 'comercio-contraoferta', 100), async (req, res) => res.status(201).json(await contraofertar(ctx, String(req.params.id), cuentaComercialDe(req), cuerpoDe(req.body))));
  r.post('/ofertas/:id/aceptar', async (req, res) => res.json(await aceptarOferta(ctx, String(req.params.id), cuentaComercialDe(req))));
  r.post('/ofertas/:id/rechazar', async (req, res) => res.json(await rechazarOferta(ctx, String(req.params.id), cuentaComercialDe(req))));
  r.get('/operaciones', async (req, res) => res.json({ operaciones: await listarOperaciones(ctx, cuentaComercialDe(req)) }));
  r.get('/operaciones/:id', async (req, res) => res.json(await obtenerOperacion(ctx, String(req.params.id), cuentaComercialDe(req))));
  r.post('/operaciones/:id/evidencias', limitarAcceso(ctx.db, 'comercio-evidencia', 100), async (req, res) => res.status(201).json(await agregarEvidencia(ctx, String(req.params.id), cuentaComercialDe(req), cuerpoDe(req.body))));
  r.get('/resumen', async (req, res) => res.json(await resumenComercial(ctx, cuentaComercialDe(req))));
  return r;
}
