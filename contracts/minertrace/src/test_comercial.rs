use super::*;

const UNIDAD: i128 = 10_000_000;
const PLAZO_ENTREGA: u64 = 86_400;

fn configurar(p: &Prueba, minimo: i128, maximo: i128) -> Address {
    let plataforma = Address::generate(&p.env);
    p.contrato
        .configurar_comercio(&plataforma, &minimo, &maximo, &PLAZO_ENTREGA);
    plataforma
}

fn condiciones(p: &Prueba) -> VentaComercial {
    p.contrato.get_venta_comercial(&p.lote())
}

#[test]
fn cuotas_congeladas_solo_se_pagan_al_liquidar() {
    let p = Prueba::nueva();
    p.certificar();
    let plataforma = configurar(&p, 20 * UNIDAD, 100 * UNIDAD);
    p.contrato
        .registrar_gasto_ensayo(&p.lab_a, &p.lote(), &(10 * UNIDAD), &hash(&p.env, 20));
    p.contrato.list_batch(&p.vendedor, &p.lote(), &PRECIO);
    let cotizacion = condiciones(&p);
    assert_eq!(
        (cotizacion.comision, cotizacion.reintegro, cotizacion.total),
        (20 * UNIDAD, 25 * UNIDAD / 10, PRECIO + 20 * UNIDAD)
    );
    // Una configuración posterior no altera ni cuotas ni destinatario de esta orden.
    let otra_plataforma = configurar(&p, 60 * UNIDAD, UNIDAD);
    assert_eq!(condiciones(&p), cotizacion);
    p.contrato.buy(&p.comprador, &p.lote());
    assert_eq!(p.token.balance(&p.id), cotizacion.total);
    assert_eq!(p.token.balance(&p.vendedor), 0);
    assert_eq!(p.token.balance(&plataforma), 0);
    assert_eq!(
        p.contrato.try_get_liquidacion(&p.lote()),
        Err(Ok(Error::SinLiquidacion))
    );
    p.contrato.confirm(&p.comprador, &p.lote());
    assert_eq!(p.token.balance(&p.vendedor), PRECIO + cotizacion.reintegro);
    assert_eq!(
        p.token.balance(&plataforma),
        cotizacion.comision - cotizacion.reintegro
    );
    assert_eq!(p.token.balance(&otra_plataforma), 0);
    assert_eq!(p.token.balance(&p.id), 0);
    let liquidacion = p.contrato.get_liquidacion(&p.lote());
    assert_eq!(liquidacion.resultado, ResultadoLiquidacion::Pagada);
    assert_eq!(liquidacion.comercial.destinatario_plataforma, plataforma);
    assert!(
        liquidacion.comercial.recepcion.is_some(),
        "confirm es reconocimiento firmado del comprador"
    );
    assert_eq!(
        liquidacion.recibido_vendedor + liquidacion.recibido_plataforma,
        cotizacion.total
    );
    assert_eq!(liquidacion.devuelto_comprador, 0);
    assert_eq!(p.contrato.get_historial_liquidaciones(&p.lote()).len(), 1);
    assert_eq!(
        p.contrato.try_confirm(&p.comprador, &p.lote()),
        Err(Ok(Error::LoteNoDisponible))
    );
}

#[test]
fn reintegro_limitado_por_coste_porcentaje_y_tope() {
    for (costo, tope, esperado) in [
        (UNIDAD, 100 * UNIDAD, UNIDAD),
        (10 * UNIDAD, UNIDAD, UNIDAD),
        (10 * UNIDAD, 100 * UNIDAD, 25 * UNIDAD / 10),
    ] {
        let p = Prueba::nueva();
        p.certificar();
        configurar(&p, 20 * UNIDAD, tope);
        p.contrato
            .registrar_gasto_ensayo(&p.lab_a, &p.lote(), &costo, &hash(&p.env, 20));
        p.contrato.list_batch(&p.vendedor, &p.lote(), &PRECIO);
        assert_eq!(condiciones(&p).reintegro, esperado);
    }
    let p = Prueba::nueva();
    p.certificar();
    configurar(&p, 20 * UNIDAD, 100 * UNIDAD);
    p.contrato.list_batch(&p.vendedor, &p.lote(), &PRECIO);
    assert_eq!(
        condiciones(&p).reintegro,
        0,
        "sin gasto acreditado no existe incentivo"
    );
}

#[test]
fn redondeo_exacto_y_sin_desbordamientos() {
    let p = Prueba::nueva();
    p.certificar();
    configurar(&p, 0, 1_000_000);
    p.contrato
        .registrar_gasto_ensayo(&p.lab_a, &p.lote(), &1_000_000, &hash(&p.env, 20));
    for precio in [1_i128, 99, 100, 101, 399, 400, 10_001, 123_456] {
        p.contrato.list_batch(&p.vendedor, &p.lote(), &precio);
        let c = condiciones(&p);
        assert_eq!(
            c.comision,
            (precio + 99) / 100,
            "comisión de 1 % hacia arriba"
        );
        assert_eq!(c.reintegro, precio / 400, "incentivo de 0,25 % hacia abajo");
        assert_eq!(c.total, precio + c.comision);
        p.contrato.cancelar_venta(&p.vendedor, &p.lote());
    }
    assert_eq!(
        p.contrato
            .try_list_batch(&p.vendedor, &p.lote(), &i128::MAX),
        Err(Ok(Error::ImporteFueraDeRango))
    );
    assert_eq!(p.estado(), EstadoLote::Certificado);
    assert!(p.contrato.listed_batches().is_empty());
    assert_eq!(p.token.balance(&p.id), 0);
}

#[test]
fn configuracion_invalida_no_se_guarda() {
    let p = Prueba::nueva();
    let plataforma = Address::generate(&p.env);
    assert_eq!(p.contrato.get_comercio(), None);
    for (minimo, maximo, plazo) in [(-1, 0, 1_u64), (0, -1, 1), (0, 0, 0)] {
        assert_eq!(
            p.contrato
                .try_configurar_comercio(&plataforma, &minimo, &maximo, &plazo),
            Err(Ok(Error::ConfiguracionComercialInvalida))
        );
    }
    assert_eq!(
        p.contrato.try_configurar_comercio(&p.id, &0, &0, &1),
        Err(Ok(Error::ConfiguracionComercialInvalida))
    );
    assert_eq!(p.contrato.get_comercio(), None);
    p.contrato.configurar_comercio(&plataforma, &0, &0, &1);
    let c = p.contrato.get_comercio().unwrap();
    assert_eq!((c.version, c.comision_bps, c.reintegro_bps), (2, 100, 25));
}

#[test]
fn reserva_comprador_importe_vigencia_y_orden_irrepetible() {
    let p = Prueba::nueva();
    p.env.ledger().with_mut(|l| l.timestamp = 100);
    p.certificar();
    configurar(&p, 20 * UNIDAD, 100 * UNIDAD);
    let orden = texto(&p.env, "ORD-001");
    p.contrato.reservar_venta(
        &p.vendedor,
        &p.lote(),
        &p.comprador,
        &PRECIO,
        &orden,
        &200,
        &hash(&p.env, 30),
    );
    let reservada = condiciones(&p);
    assert_eq!(
        (reservada.orden_id, reservada.comprador_reservado),
        (Some(orden.clone()), Some(p.comprador.clone()))
    );
    assert_eq!(reservada.condiciones_hash, Some(hash(&p.env, 30)));
    let otro = Address::generate(&p.env);
    assert_eq!(
        p.contrato.try_buy(&otro, &p.lote()),
        Err(Ok(Error::CompradorNoReservado))
    );
    assert_eq!(p.token.balance(&p.id), 0);
    p.env.ledger().with_mut(|l| l.timestamp = 200);
    assert_eq!(
        p.contrato.try_buy(&p.comprador, &p.lote()),
        Err(Ok(Error::PublicacionVencida))
    );
    assert!(!p.contrato.get_orden_cancelada(&orden));
    p.contrato.cancelar_venta(&p.vendedor, &p.lote());
    assert!(p.contrato.get_orden_cancelada(&orden));
    assert_eq!(
        p.contrato.try_reservar_venta(
            &p.vendedor,
            &p.lote(),
            &p.comprador,
            &PRECIO,
            &orden,
            &300,
            &hash(&p.env, 30)
        ),
        Err(Ok(Error::OrdenReutilizada))
    );
    assert_eq!(
        p.contrato.try_reservar_venta(
            &p.vendedor,
            &p.lote(),
            &p.comprador,
            &PRECIO,
            &texto(&p.env, ""),
            &300,
            &hash(&p.env, 30)
        ),
        Err(Ok(Error::OrdenInvalida))
    );
    assert_eq!(
        p.contrato.try_reservar_venta(
            &p.vendedor,
            &p.lote(),
            &p.comprador,
            &PRECIO,
            &texto(&p.env, "ORD-002"),
            &300,
            &hash(&p.env, 0)
        ),
        Err(Ok(Error::EvidenciaInvalida))
    );
    p.contrato.reservar_venta(
        &p.vendedor,
        &p.lote(),
        &p.comprador,
        &PRECIO,
        &texto(&p.env, "ORD-002"),
        &300,
        &hash(&p.env, 30),
    );
    p.contrato.buy(&p.comprador, &p.lote());
    assert_eq!(
        p.contrato.try_cancelar_venta(&p.vendedor, &p.lote()),
        Err(Ok(Error::LoteNoDisponible))
    );
    assert_eq!(
        p.contrato.try_buy(&p.comprador, &p.lote()),
        Err(Ok(Error::LoteNoDisponible))
    );
    assert_eq!(p.token.balance(&p.id), PRECIO + 20 * UNIDAD);
}

#[test]
fn sin_recepcion_no_se_cobra_y_no_entrega_devuelve_todo() {
    let p = Prueba::nueva();
    p.env.ledger().with_mut(|l| l.timestamp = 1_000);
    p.certificar();
    let plataforma = configurar(&p, 20 * UNIDAD, 100 * UNIDAD);
    p.publicar_y_comprar();
    let vence = 1_000 + PLAZO_ENTREGA;
    assert_eq!(condiciones(&p).vence_entrega, Some(vence));
    assert_eq!(p.contrato.get_sale(&p.lote()).vence_garantia, None);
    assert_eq!(
        p.contrato.try_claim(&p.vendedor, &p.lote()),
        Err(Ok(Error::SinRecepcion))
    );
    p.env.ledger().with_mut(|l| l.timestamp = vence - 1);
    assert_eq!(
        p.contrato.try_cancelar_compra(&p.comprador, &p.lote()),
        Err(Ok(Error::PlazoEntregaNoVencido))
    );
    p.env.ledger().with_mut(|l| l.timestamp = vence);
    p.contrato.cancelar_compra(&p.comprador, &p.lote());
    assert_eq!(p.estado(), EstadoLote::Certificado);
    assert_eq!(p.token.balance(&p.comprador), 2 * PRECIO);
    assert_eq!(p.token.balance(&p.id), 0);
    assert_eq!(p.token.balance(&p.vendedor), 0);
    assert_eq!(p.token.balance(&plataforma), 0);
    let liquidacion = p.contrato.get_liquidacion(&p.lote());
    assert_eq!(liquidacion.resultado, ResultadoLiquidacion::Reembolsada);
    assert_eq!(liquidacion.devuelto_comprador, PRECIO + 20 * UNIDAD);
    assert_eq!(
        p.contrato.try_cancelar_compra(&p.comprador, &p.lote()),
        Err(Ok(Error::LoteNoDisponible))
    );
}

#[test]
fn laboratorio_acredita_entrega_y_arranca_inspeccion() {
    let p = Prueba::nueva();
    p.env.ledger().with_mut(|l| l.timestamp = 1_000);
    p.certificar();
    configurar(&p, 20 * UNIDAD, 100 * UNIDAD);
    p.publicar_y_comprar();
    p.env.ledger().with_mut(|l| l.timestamp = 2_000);
    assert_eq!(
        p.contrato
            .try_atestiguar_entrega(&p.lab_b, &p.lote(), &hash(&p.env, 40)),
        Err(Ok(Error::LaboratorioDistinto))
    );
    assert_eq!(
        p.contrato
            .try_registrar_recepcion(&p.vendedor, &p.lote(), &hash(&p.env, 40)),
        Err(Ok(Error::NoEsComprador))
    );
    assert_eq!(
        p.contrato
            .try_registrar_recepcion(&p.comprador, &p.lote(), &hash(&p.env, 0)),
        Err(Ok(Error::EvidenciaInvalida))
    );
    p.contrato
        .atestiguar_entrega(&p.lab_a, &p.lote(), &hash(&p.env, 40));
    let vence = 2_000 + PLAZO_SEG;
    assert_eq!(p.contrato.get_sale(&p.lote()).vence_garantia, Some(vence));
    let recibo_val: Val = condiciones(&p).recepcion.unwrap().into_val(&p.env);
    let recibo = Recepcion::try_from_val(&p.env, &recibo_val).unwrap();
    assert_eq!((recibo.fecha, recibo.acreditador), (2_000, p.lab_a.clone()));
    assert_eq!(
        p.contrato
            .try_registrar_recepcion(&p.comprador, &p.lote(), &hash(&p.env, 41)),
        Err(Ok(Error::RecepcionExistente))
    );
    assert_eq!(
        p.contrato.try_cancelar_compra(&p.comprador, &p.lote()),
        Err(Ok(Error::LoteNoDisponible))
    );
    p.env.ledger().with_mut(|l| l.timestamp = vence - 1);
    assert_eq!(
        p.contrato.try_claim(&p.vendedor, &p.lote()),
        Err(Ok(Error::PlazoNoVencido))
    );
    p.env.ledger().with_mut(|l| l.timestamp = vence);
    assert_eq!(
        p.contrato
            .try_abrir_incidencia(&p.comprador, &p.lote(), &texto(&p.env, "tarde")),
        Err(Ok(Error::GarantiaVencida))
    );
    assert_eq!(
        p.contrato
            .try_counter_analysis(&p.lab_b, &p.lote(), &hash(&p.env, 42), &7000),
        Err(Ok(Error::GarantiaVencida))
    );
    p.contrato.claim(&p.vendedor, &p.lote());
    assert_eq!(p.estado(), EstadoLote::Vendido);
    assert_eq!(p.token.balance(&p.vendedor), PRECIO);
    assert_eq!(p.token.balance(&p.id), 0);
}

#[test]
fn incidencia_fisica_bloquea_salida_automatica_y_exige_arbitraje() {
    let p = Prueba::nueva();
    p.certificar();
    configurar(&p, 20 * UNIDAD, 100 * UNIDAD);
    p.publicar_y_comprar();
    p.contrato
        .registrar_recepcion(&p.comprador, &p.lote(), &hash(&p.env, 40));
    let admin = p.contrato.get_config().admin;
    assert_eq!(
        p.contrato
            .try_abrir_incidencia(&p.vendedor, &p.lote(), &texto(&p.env, "Sin paquete")),
        Err(Ok(Error::NoEsComprador))
    );
    assert_eq!(
        p.contrato
            .try_abrir_incidencia(&p.comprador, &p.lote(), &texto(&p.env, "")),
        Err(Ok(Error::MotivoInvalido))
    );
    p.contrato
        .abrir_incidencia(&p.comprador, &p.lote(), &texto(&p.env, "Precinto distinto"));
    assert_eq!(
        p.contrato
            .try_abrir_incidencia(&p.comprador, &p.lote(), &texto(&p.env, "Otra vez")),
        Err(Ok(Error::IncidenciaExistente))
    );
    p.env.ledger().with_mut(|l| l.timestamp += 2 * PLAZO_SEG);
    assert_eq!(
        p.contrato.try_claim(&p.vendedor, &p.lote()),
        Err(Ok(Error::LoteEnDisputa))
    );
    assert_eq!(
        p.contrato.try_confirm(&p.comprador, &p.lote()),
        Err(Ok(Error::LoteEnDisputa))
    );
    assert_eq!(
        p.contrato.try_cancelar_compra(&p.comprador, &p.lote()),
        Err(Ok(Error::LoteEnDisputa))
    );
    assert_eq!(
        p.contrato.try_refund(&p.comprador, &p.lote()),
        Err(Ok(Error::LoteEnDisputa))
    );
    assert_eq!(
        p.contrato
            .try_resolver_incidencia(&p.vendedor, &p.lote(), &true, &hash(&p.env, 41)),
        Err(Ok(Error::NoEsAdministrador))
    );
    assert_eq!(
        p.contrato
            .try_resolver_incidencia(&admin, &p.lote(), &true, &hash(&p.env, 0)),
        Err(Ok(Error::DevolucionNoAcreditada))
    );
    p.contrato
        .resolver_incidencia(&admin, &p.lote(), &true, &hash(&p.env, 41));
    assert_eq!(p.token.balance(&p.comprador), 2 * PRECIO);
    assert_eq!(p.token.balance(&p.vendedor), 0);
    assert_eq!(p.estado(), EstadoLote::Certificado);
    assert_eq!(
        p.contrato
            .try_resolver_incidencia(&admin, &p.lote(), &true, &hash(&p.env, 41)),
        Err(Ok(Error::LoteNoDisponible))
    );
}

#[test]
fn arbitraje_sin_entrega_reembolsa_y_no_puede_pagar_vendedor() {
    let p = Prueba::nueva();
    p.certificar();
    configurar(&p, 20 * UNIDAD, 100 * UNIDAD);
    p.publicar_y_comprar();
    p.contrato
        .abrir_incidencia(&p.comprador, &p.lote(), &texto(&p.env, "No llegó"));
    let admin = p.contrato.get_config().admin;
    assert_eq!(
        p.contrato
            .try_resolver_incidencia(&admin, &p.lote(), &false, &hash(&p.env, 0)),
        Err(Ok(Error::SinRecepcion))
    );
    p.contrato
        .resolver_incidencia(&admin, &p.lote(), &true, &hash(&p.env, 0));
    assert_eq!(p.token.balance(&p.comprador), 2 * PRECIO);
    assert_eq!(p.token.balance(&p.id), 0);
}

#[test]
fn arbitraje_paga_solo_si_entrega_acreditada_y_no_devolucion() {
    let p = Prueba::nueva();
    p.certificar();
    let plataforma = configurar(&p, 20 * UNIDAD, 100 * UNIDAD);
    p.publicar_y_comprar();
    p.contrato
        .atestiguar_entrega(&p.lab_a, &p.lote(), &hash(&p.env, 40));
    p.contrato
        .abrir_incidencia(&p.comprador, &p.lote(), &texto(&p.env, "Revisar entrega"));
    let admin = p.contrato.get_config().admin;
    p.contrato
        .resolver_incidencia(&admin, &p.lote(), &false, &hash(&p.env, 0));
    assert_eq!(p.token.balance(&p.vendedor), PRECIO);
    assert_eq!(p.token.balance(&plataforma), 20 * UNIDAD);
    assert_eq!(p.contrato.get_batch(&p.lote()).dueno, p.comprador);
}

#[test]
fn discrepancia_exige_devolucion_y_reembolso_no_consume_incentivo() {
    let p = Prueba::nueva();
    p.certificar();
    let plataforma = configurar(&p, 20 * UNIDAD, 100 * UNIDAD);
    p.contrato
        .registrar_gasto_ensayo(&p.lab_a, &p.lote(), &(10 * UNIDAD), &hash(&p.env, 20));
    p.publicar_y_comprar();
    let incentivo = condiciones(&p).reintegro;
    p.contrato
        .counter_analysis(&p.lab_b, &p.lote(), &hash(&p.env, 5), &7000);
    assert_eq!(
        p.contrato.try_cancelar_compra(&p.comprador, &p.lote()),
        Err(Ok(Error::LoteEnDisputa))
    );
    assert_eq!(
        p.contrato.try_refund(&p.comprador, &p.lote()),
        Err(Ok(Error::DevolucionNoAcreditada))
    );
    assert_eq!(
        p.contrato
            .try_registrar_devolucion(&p.lab_b, &p.lote(), &hash(&p.env, 41)),
        Err(Ok(Error::LaboratorioDistinto))
    );
    p.contrato
        .registrar_devolucion(&p.lab_a, &p.lote(), &hash(&p.env, 41));
    assert_eq!(
        p.contrato
            .try_registrar_devolucion(&p.lab_a, &p.lote(), &hash(&p.env, 42)),
        Err(Ok(Error::RecepcionExistente))
    );
    p.contrato.refund(&p.comprador, &p.lote());
    assert_eq!(p.token.balance(&p.comprador), 2 * PRECIO);
    assert_eq!(p.token.balance(&plataforma), 0);
    assert_eq!(p.contrato.get_liquidacion(&p.lote()).reintegro, 0);
    p.contrato.submit_analysis(
        &p.lab_a,
        &p.lote(),
        &p.vendedor,
        &texto(&p.env, ANALISIS),
        &2,
        &hash(&p.env, 2),
        &Some(hash(&p.env, 1)),
        &7000,
    );
    p.contrato.list_batch(&p.vendedor, &p.lote(), &PRECIO);
    assert_eq!(condiciones(&p).reintegro, incentivo);
    p.contrato.buy(&p.comprador, &p.lote());
    p.contrato.confirm(&p.comprador, &p.lote());
    let historial = p.contrato.get_historial_liquidaciones(&p.lote());
    assert_eq!(historial.len(), 2);
    assert_eq!(
        historial.get(0).unwrap().resultado,
        ResultadoLiquidacion::Reembolsada
    );
    assert_eq!(
        historial.get(1).unwrap().resultado,
        ResultadoLiquidacion::Pagada
    );
}

#[test]
fn incentivo_unico_incluso_al_revender_y_historial_conserva_ordenes() {
    let p = Prueba::nueva();
    p.certificar();
    configurar(&p, 20 * UNIDAD, 100 * UNIDAD);
    p.contrato
        .registrar_gasto_ensayo(&p.lab_a, &p.lote(), &(10 * UNIDAD), &hash(&p.env, 20));
    p.contrato.reservar_venta(
        &p.vendedor,
        &p.lote(),
        &p.comprador,
        &PRECIO,
        &texto(&p.env, "ORD-A"),
        &10_000,
        &hash(&p.env, 30),
    );
    p.contrato.buy(&p.comprador, &p.lote());
    p.contrato.confirm(&p.comprador, &p.lote());
    p.contrato.reservar_venta(
        &p.comprador,
        &p.lote(),
        &p.vendedor,
        &(PRECIO / 2),
        &texto(&p.env, "ORD-B"),
        &10_000,
        &hash(&p.env, 31),
    );
    assert_eq!(condiciones(&p).reintegro, 0);
    p.contrato.buy(&p.vendedor, &p.lote());
    p.contrato.confirm(&p.vendedor, &p.lote());
    let historial = p.contrato.get_historial_liquidaciones(&p.lote());
    assert_eq!(historial.len(), 2);
    assert_eq!(
        historial.get(0).unwrap().comercial.orden_id,
        Some(texto(&p.env, "ORD-A"))
    );
    assert_eq!(historial.get(0).unwrap().reintegro, 25 * UNIDAD / 10);
    assert_eq!(
        historial.get(1).unwrap().comercial.orden_id,
        Some(texto(&p.env, "ORD-B"))
    );
    assert_eq!(historial.get(1).unwrap().reintegro, 0);
    assert_eq!(p.contrato.get_liquidacion(&p.lote()).numero, 2);
    assert_eq!(p.token.balance(&p.id), 0);
}

#[test]
fn gasto_solo_laboratorio_certificador_y_comprobante_no_reutilizable() {
    let p = Prueba::nueva();
    p.certificar();
    assert_eq!(
        p.contrato
            .try_registrar_gasto_ensayo(&p.lab_b, &p.lote(), &100, &hash(&p.env, 20)),
        Err(Ok(Error::LaboratorioDistinto))
    );
    assert_eq!(
        p.contrato
            .try_registrar_gasto_ensayo(&p.lab_a, &p.lote(), &0, &hash(&p.env, 20)),
        Err(Ok(Error::PrecioInvalido))
    );
    assert_eq!(
        p.contrato
            .try_registrar_gasto_ensayo(&p.lab_a, &p.lote(), &100, &hash(&p.env, 0)),
        Err(Ok(Error::EvidenciaInvalida))
    );
    p.contrato
        .registrar_gasto_ensayo(&p.lab_a, &p.lote(), &100, &hash(&p.env, 20));
    assert_eq!(
        p.contrato
            .try_registrar_gasto_ensayo(&p.lab_a, &p.lote(), &100, &hash(&p.env, 21)),
        Err(Ok(Error::GastoEnsayoExistente))
    );
    let otro = texto(&p.env, "LT-OTRO");
    p.contrato.submit_analysis(
        &p.lab_a,
        &otro,
        &p.vendedor,
        &texto(&p.env, "AN-OTRO"),
        &1,
        &hash(&p.env, 2),
        &None,
        &7500,
    );
    assert_eq!(
        p.contrato
            .try_registrar_gasto_ensayo(&p.lab_a, &otro, &100, &hash(&p.env, 20)),
        Err(Ok(Error::ComprobanteReutilizado))
    );
    p.contrato.revoke_lab(&p.lab_a);
    assert_eq!(
        p.contrato
            .try_registrar_gasto_ensayo(&p.lab_a, &otro, &100, &hash(&p.env, 21)),
        Err(Ok(Error::LaboratorioNoAutorizado))
    );
}

#[test]
fn nuevas_mutaciones_requieren_firma_del_actor() {
    let p = Prueba::nueva();
    p.certificar();
    let plataforma = configurar(&p, 20 * UNIDAD, 100 * UNIDAD);
    p.env.mock_auths(&[]);
    assert_eq!(
        p.contrato.try_configurar_comercio(&plataforma, &0, &0, &1),
        Err(Err(InvokeError::Abort))
    );
    assert_eq!(
        p.contrato
            .try_registrar_gasto_ensayo(&p.lab_a, &p.lote(), &100, &hash(&p.env, 20)),
        Err(Err(InvokeError::Abort))
    );
    assert_eq!(
        p.contrato.try_reservar_venta(
            &p.vendedor,
            &p.lote(),
            &p.comprador,
            &PRECIO,
            &texto(&p.env, "ORD-A"),
            &10_000,
            &hash(&p.env, 30)
        ),
        Err(Err(InvokeError::Abort))
    );
    p.env.mock_all_auths();
    p.publicar_y_comprar();
    p.env.mock_auths(&[]);
    assert_eq!(
        p.contrato.try_cancelar_venta(&p.vendedor, &p.lote()),
        Err(Err(InvokeError::Abort))
    );
    assert_eq!(
        p.contrato
            .try_registrar_recepcion(&p.comprador, &p.lote(), &hash(&p.env, 40)),
        Err(Err(InvokeError::Abort))
    );
    assert_eq!(
        p.contrato
            .try_atestiguar_entrega(&p.lab_a, &p.lote(), &hash(&p.env, 40)),
        Err(Err(InvokeError::Abort))
    );
    assert_eq!(
        p.contrato
            .try_abrir_incidencia(&p.comprador, &p.lote(), &texto(&p.env, "Entrega")),
        Err(Err(InvokeError::Abort))
    );
    assert_eq!(
        p.contrato.try_cancelar_compra(&p.comprador, &p.lote()),
        Err(Err(InvokeError::Abort))
    );
    assert_eq!(
        p.contrato
            .try_registrar_devolucion(&p.lab_a, &p.lote(), &hash(&p.env, 41)),
        Err(Err(InvokeError::Abort))
    );
    assert_eq!(
        p.contrato.try_resolver_incidencia(
            &p.contrato.get_config().admin,
            &p.lote(),
            &true,
            &hash(&p.env, 41)
        ),
        Err(Err(InvokeError::Abort))
    );
    assert_eq!(p.token.balance(&p.id), PRECIO + 20 * UNIDAD);
}

#[test]
fn financiacion_rechaza_orden_republicada_total_y_analisis_distintos() {
    let p = Prueba::nueva();
    p.certificar();
    configurar(&p, 20 * UNIDAD, 100 * UNIDAD);
    let orden_a = texto(&p.env, "ORD-A");
    let orden_b = texto(&p.env, "ORD-B");
    let analisis = texto(&p.env, ANALISIS);
    p.contrato.reservar_venta(
        &p.vendedor,
        &p.lote(),
        &p.comprador,
        &PRECIO,
        &orden_a,
        &10_000,
        &hash(&p.env, 30),
    );
    let total_a = condiciones(&p).total;
    p.contrato.cancelar_venta(&p.vendedor, &p.lote());
    // Mismo comprador, importe y lote; otro acuerdo ya no acepta la autorización de la orden cancelada.
    p.contrato.reservar_venta(
        &p.vendedor,
        &p.lote(),
        &p.comprador,
        &PRECIO,
        &orden_b,
        &10_000,
        &hash(&p.env, 31),
    );
    assert_eq!(
        p.contrato
            .try_financiar_orden(&p.comprador, &p.lote(), &orden_a, &total_a, &analisis, &1),
        Err(Ok(Error::CotizacionDesactualizada))
    );
    assert_eq!(
        p.contrato.try_financiar_orden(
            &p.comprador,
            &p.lote(),
            &texto(&p.env, ""),
            &total_a,
            &analisis,
            &1
        ),
        Err(Ok(Error::CotizacionDesactualizada))
    );
    assert_eq!(
        p.contrato.try_financiar_orden(
            &p.comprador,
            &p.lote(),
            &orden_b,
            &(total_a - 1),
            &analisis,
            &1
        ),
        Err(Ok(Error::CotizacionDesactualizada))
    );
    assert_eq!(
        p.contrato.try_financiar_orden(
            &p.comprador,
            &p.lote(),
            &orden_b,
            &total_a,
            &texto(&p.env, "AN-OTRO"),
            &1
        ),
        Err(Ok(Error::CotizacionDesactualizada))
    );
    assert_eq!(
        p.contrato
            .try_financiar_orden(&p.comprador, &p.lote(), &orden_b, &total_a, &analisis, &2),
        Err(Ok(Error::CotizacionDesactualizada))
    );
    assert_eq!(p.token.balance(&p.comprador), 2 * PRECIO);
    assert_eq!(p.token.balance(&p.id), 0);
    p.env.mock_auths(&[]);
    assert_eq!(
        p.contrato
            .try_financiar_orden(&p.comprador, &p.lote(), &orden_b, &total_a, &analisis, &1),
        Err(Err(InvokeError::Abort))
    );
    p.env.mock_all_auths();
    p.contrato
        .financiar_orden(&p.comprador, &p.lote(), &orden_b, &total_a, &analisis, &1);
    let invocacion = p.env.auths().first().unwrap().1.clone();
    assert_eq!(
        invocacion.function,
        AuthorizedFunction::Contract((
            p.id.clone(),
            soroban_sdk::Symbol::new(&p.env, "financiar_orden"),
            (
                p.comprador.clone(),
                p.lote(),
                orden_b,
                total_a,
                analisis,
                1_u32
            )
                .into_val(&p.env),
        ))
    );
    assert_eq!(p.token.balance(&p.id), total_a);
}

#[test]
fn financiar_catalogo_fija_total_y_version_de_la_cotizacion() {
    let p = Prueba::nueva();
    p.certificar();
    configurar(&p, 20 * UNIDAD, 100 * UNIDAD);
    p.contrato.list_batch(&p.vendedor, &p.lote(), &PRECIO);
    let total = condiciones(&p).total;
    p.contrato.cancelar_venta(&p.vendedor, &p.lote());
    p.contrato.submit_analysis(
        &p.lab_a,
        &p.lote(),
        &p.vendedor,
        &texto(&p.env, ANALISIS),
        &2,
        &hash(&p.env, 2),
        &Some(hash(&p.env, 1)),
        &7400,
    );
    p.contrato.list_batch(&p.vendedor, &p.lote(), &PRECIO);
    assert_eq!(
        p.contrato.try_financiar_orden(
            &p.comprador,
            &p.lote(),
            &texto(&p.env, ""),
            &total,
            &texto(&p.env, ANALISIS),
            &1
        ),
        Err(Ok(Error::CotizacionDesactualizada))
    );
    p.contrato.financiar_orden(
        &p.comprador,
        &p.lote(),
        &texto(&p.env, ""),
        &total,
        &texto(&p.env, ANALISIS),
        &2,
    );
    assert_eq!(p.token.balance(&p.id), total);
}
