#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::testutils::{
    Address as _, AuthorizedFunction, AuthorizedInvocation, Events as _, Ledger, MockAuth, MockAuthInvoke,
};
use soroban_sdk::xdr::{ScErrorCode, ScErrorType};
use soroban_sdk::{symbol_short, token, Address, BytesN, Env, Event, IntoVal, InvokeError, String};

const TOLERANCIA_BPS: u32 = 200;
/// Siete días de garantía.
const PLAZO_SEG: u64 = 7 * 24 * 60 * 60;
/// 1000 unidades de un token de 7 decimales (como XLM).
const PRECIO: i128 = 10_000_000_000;
const LOTE: &str = "LT-2026-0457";
const ANALISIS: &str = "AN-2026-0001";

fn texto(env: &Env, valor: &str) -> String {
    String::from_str(env, valor)
}

fn hash(env: &Env, n: u8) -> BytesN<32> {
    BytesN::from_array(env, &[n; 32])
}

struct Prueba<'a> {
    env: Env,
    id: Address,
    contrato: MinerTraceClient<'a>,
    token: token::Client<'a>,

    lab_a: Address,
    lab_b: Address,
    vendedor: Address,
    comprador: Address,
}

impl<'a> Prueba<'a> {
    /// Contrato con dos laboratorios autorizados y un comprador con saldo para dos compras.
    fn nueva() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let lab_a = Address::generate(&env);
        let lab_b = Address::generate(&env);
        let vendedor = Address::generate(&env);
        let comprador = Address::generate(&env);

        let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
        token::StellarAssetClient::new(&env, &sac.address()).mint(&comprador, &(2 * PRECIO));

        let id = env.register(MinerTrace, (admin.clone(), sac.address(), TOLERANCIA_BPS, PLAZO_SEG));
        let contrato = MinerTraceClient::new(&env, &id);
        contrato.add_lab(&lab_a, &texto(&env, "Laboratorio A"));
        contrato.add_lab(&lab_b, &texto(&env, "Laboratorio B"));

        Prueba {
            token: token::Client::new(&env, &sac.address()),
            env,
            id,
            contrato,

            lab_a,
            lab_b,
            vendedor,
            comprador,
        }
    }

    fn lote(&self) -> String {
        texto(&self.env, LOTE)
    }

    /// Versión 1 del análisis, 75.00 % de pureza, registrada por el laboratorio A.
    fn certificar(&self) {
        self.contrato.submit_analysis(
            &self.lab_a,
            &self.lote(),
            &self.vendedor,
            &texto(&self.env, ANALISIS),
            &1,
            &hash(&self.env, 1),
            &None,
            &7500,
        );
    }

    fn publicar_y_comprar(&self) {
        self.contrato.list_batch(&self.vendedor, &self.lote(), &PRECIO);
        self.contrato.buy(&self.comprador, &self.lote());
    }

    fn estado(&self) -> EstadoLote {
        self.contrato.get_batch(&self.lote()).estado
    }
}

#[test]
fn laboratorio_no_autorizado() {
    let p = Prueba::nueva();
    let intruso = Address::generate(&p.env);
    let r = p.contrato.try_submit_analysis(
        &intruso,
        &p.lote(),
        &p.vendedor,
        &texto(&p.env, ANALISIS),
        &1,
        &hash(&p.env, 1),
        &None,
        &7500,
    );
    assert_eq!(r, Err(Ok(Error::LaboratorioNoAutorizado)));
    assert!(!p.contrato.is_lab(&intruso));
    assert_eq!(p.contrato.try_get_batch(&p.lote()), Err(Ok(Error::LoteInexistente)));
    assert_eq!(p.contrato.try_revoke_lab(&intruso), Err(Ok(Error::LaboratorioInexistente)));
}

#[test]
fn laboratorio_revocado() {
    let p = Prueba::nueva();
    p.certificar();
    p.contrato.revoke_lab(&p.lab_a);
    assert!(!p.contrato.is_lab(&p.lab_a));
    assert_eq!(p.contrato.get_lab(&p.lab_a).map(|l| l.activo), Some(false));

    // Ya no puede registrar versiones nuevas...
    let r = p.contrato.try_submit_analysis(
        &p.lab_a,
        &p.lote(),
        &p.vendedor,
        &texto(&p.env, ANALISIS),
        &2,
        &hash(&p.env, 2),
        &Some(hash(&p.env, 1)),
        &7500,
    );
    assert_eq!(r, Err(Ok(Error::LaboratorioNoAutorizado)));
    // ...y su certificación deja de servir para vender.
    assert_eq!(
        p.contrato.try_list_batch(&p.vendedor, &p.lote(), &PRECIO),
        Err(Ok(Error::AnalisisNoValido))
    );
    // El registro histórico no se borra.
    assert_eq!(p.contrato.get_analysis(&texto(&p.env, ANALISIS), &1).hash, hash(&p.env, 1));
}

#[test]
fn version_duplicada() {
    let p = Prueba::nueva();
    p.certificar();
    let registrar = |version: u32, hash_anterior: Option<BytesN<32>>| {
        p.contrato.try_submit_analysis(
            &p.lab_a,
            &p.lote(),
            &p.vendedor,
            &texto(&p.env, ANALISIS),
            &version,
            &hash(&p.env, 9),
            &hash_anterior,
            &7000,
        )
    };
    assert_eq!(registrar(1, None), Err(Ok(Error::VersionDuplicada)));
    assert_eq!(registrar(0, None), Err(Ok(Error::VersionInvalida)));
    assert_eq!(registrar(3, Some(hash(&p.env, 1))), Err(Ok(Error::VersionAnteriorInexistente)));
    // La versión 1 sigue intacta.
    assert_eq!(p.contrato.get_analysis(&texto(&p.env, ANALISIS), &1).pureza_bps, 7500);
}

#[test]
fn hash_anterior_incorrecto() {
    let p = Prueba::nueva();
    p.certificar();
    let registrar = |lab: &Address, lote: &str, analisis: &str, version: u32, anterior: Option<BytesN<32>>| {
        p.contrato.try_submit_analysis(
            lab,
            &texto(&p.env, lote),
            &p.vendedor,
            &texto(&p.env, analisis),
            &version,
            &hash(&p.env, 2),
            &anterior,
            &7400,
        )
    };
    assert_eq!(registrar(&p.lab_a, LOTE, ANALISIS, 2, Some(hash(&p.env, 7))), Err(Ok(Error::HashAnteriorIncorrecto)));
    assert_eq!(registrar(&p.lab_a, LOTE, ANALISIS, 2, None), Err(Ok(Error::HashAnteriorIncorrecto)));
    assert_eq!(
        registrar(&p.lab_a, LOTE, "AN-2026-0002", 1, Some(hash(&p.env, 1))),
        Err(Ok(Error::HashAnteriorIncorrecto))
    );
    // Con el hash correcto, solo el mismo laboratorio y sobre el mismo lote.
    assert_eq!(registrar(&p.lab_b, LOTE, ANALISIS, 2, Some(hash(&p.env, 1))), Err(Ok(Error::LaboratorioDistinto)));
    assert_eq!(registrar(&p.lab_a, "LT-OTRO", ANALISIS, 2, Some(hash(&p.env, 1))), Err(Ok(Error::LoteDistinto)));

    assert_eq!(registrar(&p.lab_a, LOTE, ANALISIS, 2, Some(hash(&p.env, 1))), Ok(Ok(())));
    let v2 = p.contrato.get_analysis(&texto(&p.env, ANALISIS), &2);
    assert_eq!(v2.hash_anterior, Some(hash(&p.env, 1)));
    let lote = p.contrato.get_batch(&p.lote());
    assert_eq!((lote.version, lote.pureza_bps), (2, 7400));
}

#[test]
fn pureza_y_tolerancia_fuera_de_rango() {
    let p = Prueba::nueva();
    let r = p.contrato.try_submit_analysis(
        &p.lab_a,
        &p.lote(),
        &p.vendedor,
        &texto(&p.env, ANALISIS),
        &1,
        &hash(&p.env, 1),
        &None,
        &10_001,
    );
    assert_eq!(r, Err(Ok(Error::PurezaInvalida)));

    let env = Env::default();
    let token = Address::generate(&env);
    let resultado = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.register(MinerTrace, (Address::generate(&env), token.clone(), 10_001_u32, PLAZO_SEG))
    }));
    assert!(resultado.is_err(), "una tolerancia mayor que 100 % debe rechazarse");
    let sin_plazo = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.register(MinerTrace, (Address::generate(&env), token, TOLERANCIA_BPS, 0_u64))
    }));
    assert!(sin_plazo.is_err(), "un plazo de garantía de cero debe rechazarse");
}

#[test]
fn compra_y_confirmacion() {
    let p = Prueba::nueva();
    p.certificar();

    let extrano = Address::generate(&p.env);
    assert_eq!(p.contrato.try_list_batch(&extrano, &p.lote(), &PRECIO), Err(Ok(Error::NoEsDueno)));
    assert_eq!(p.contrato.try_list_batch(&p.vendedor, &p.lote(), &0), Err(Ok(Error::PrecioInvalido)));
    assert_eq!(p.contrato.try_buy(&p.comprador, &p.lote()), Err(Ok(Error::LoteNoDisponible)));

    p.contrato.list_batch(&p.vendedor, &p.lote(), &PRECIO);
    assert_eq!(p.estado(), EstadoLote::EnVenta);
    assert_eq!(p.contrato.listed_batches(), soroban_sdk::vec![&p.env, p.lote()]);
    assert_eq!(p.contrato.try_list_batch(&p.vendedor, &p.lote(), &PRECIO), Err(Ok(Error::LoteNoDisponible)));
    assert_eq!(p.contrato.try_buy(&p.vendedor, &p.lote()), Err(Ok(Error::CompradorEsVendedor)));

    p.contrato.buy(&p.comprador, &p.lote());
    assert_eq!(p.estado(), EstadoLote::EnGarantia);
    assert_eq!(p.token.balance(&p.comprador), PRECIO);
    assert_eq!(p.token.balance(&p.id), PRECIO);
    assert_eq!(p.contrato.listed_batches().len(), 0);
    assert_eq!(p.contrato.try_buy(&extrano, &p.lote()), Err(Ok(Error::LoteNoDisponible)));

    assert_eq!(p.contrato.try_confirm(&extrano, &p.lote()), Err(Ok(Error::NoEsComprador)));
    p.contrato.confirm(&p.comprador, &p.lote());
    let lote = p.contrato.get_batch(&p.lote());
    assert_eq!(lote.estado, EstadoLote::Vendido);
    assert_eq!(lote.dueno, p.comprador);
    assert_eq!(p.contrato.try_get_sale(&p.lote()), Err(Ok(Error::SinVenta)));
    assert_eq!(p.token.balance(&p.vendedor), PRECIO);
    assert_eq!(p.token.balance(&p.id), 0);
    assert_eq!(p.contrato.try_confirm(&p.comprador, &p.lote()), Err(Ok(Error::LoteNoDisponible)));

    // El nuevo dueño puede revender; el anterior ya no.
    assert_eq!(p.contrato.try_list_batch(&p.vendedor, &p.lote(), &PRECIO), Err(Ok(Error::NoEsDueno)));
    p.contrato.list_batch(&p.comprador, &p.lote(), &(PRECIO / 2));
    assert_eq!(p.estado(), EstadoLote::EnVenta);
}

#[test]
fn contra_analisis_dentro_de_tolerancia() {
    let p = Prueba::nueva();
    p.certificar();
    p.contrato.list_batch(&p.vendedor, &p.lote(), &PRECIO);
    // Sin compra no hay garantía que comprobar.
    assert_eq!(
        p.contrato.try_counter_analysis(&p.lab_b, &p.lote(), &hash(&p.env, 5), &7300),
        Err(Ok(Error::LoteNoDisponible))
    );
    p.contrato.buy(&p.comprador, &p.lote());

    assert_eq!(
        p.contrato.try_counter_analysis(&p.lab_a, &p.lote(), &hash(&p.env, 5), &7300),
        Err(Ok(Error::MismoLaboratorio))
    );
    let intruso = Address::generate(&p.env);
    assert_eq!(
        p.contrato.try_counter_analysis(&intruso, &p.lote(), &hash(&p.env, 5), &7300),
        Err(Ok(Error::LaboratorioNoAutorizado))
    );

    // 75.00 % frente a 73.00 %: la diferencia es justo la tolerancia (2.00 %).
    p.contrato.counter_analysis(&p.lab_b, &p.lote(), &hash(&p.env, 5), &7300);
    let lote = p.contrato.get_batch(&p.lote());
    assert_eq!(lote.estado, EstadoLote::EnGarantia);
    let contra = p.contrato.get_counter_analysis(&p.lote());
    assert_eq!((contra.lab, contra.diferencia_bps), (p.lab_b.clone(), 200));

    assert_eq!(
        p.contrato.try_counter_analysis(&p.lab_b, &p.lote(), &hash(&p.env, 6), &5000),
        Err(Ok(Error::ContraAnalisisExistente))
    );
    assert_eq!(p.contrato.try_refund(&p.comprador, &p.lote()), Err(Ok(Error::LoteNoDisponible)));

    p.contrato.confirm(&p.comprador, &p.lote());
    assert_eq!(p.estado(), EstadoLote::Vendido);
    assert_eq!(p.token.balance(&p.vendedor), PRECIO);
}

#[test]
fn contra_analisis_fuera_de_tolerancia_con_reembolso() {
    let p = Prueba::nueva();
    p.certificar();
    p.publicar_y_comprar();

    // 75.00 % frente a 72.00 %: 3 puntos, más que la tolerancia.
    p.contrato.counter_analysis(&p.lab_b, &p.lote(), &hash(&p.env, 5), &7200);
    assert_eq!(p.estado(), EstadoLote::EnDisputa);
    assert_eq!(p.contrato.try_confirm(&p.comprador, &p.lote()), Err(Ok(Error::LoteEnDisputa)));
    let extrano = Address::generate(&p.env);
    assert_eq!(p.contrato.try_refund(&extrano, &p.lote()), Err(Ok(Error::NoEsComprador)));

    p.contrato.refund(&p.comprador, &p.lote());
    assert_eq!(p.token.balance(&p.comprador), 2 * PRECIO);
    assert_eq!(p.token.balance(&p.id), 0);
    assert_eq!(p.token.balance(&p.vendedor), 0);
    let lote = p.contrato.get_batch(&p.lote());
    assert_eq!(lote.estado, EstadoLote::EnDisputa);
    assert_eq!(p.contrato.try_get_sale(&p.lote()), Err(Ok(Error::SinVenta)));
    assert_eq!(lote.dueno, p.vendedor, "el lote sigue siendo del vendedor");
    assert_eq!(p.contrato.try_refund(&p.comprador, &p.lote()), Err(Ok(Error::LoteNoDisponible)));
    assert_eq!(p.contrato.try_list_batch(&p.vendedor, &p.lote(), &PRECIO), Err(Ok(Error::LoteEnDisputa)));

    // Un análisis de otro laboratorio no desbloquea el lote...
    p.contrato.submit_analysis(
        &p.lab_b,
        &p.lote(),
        &p.vendedor,
        &texto(&p.env, "AN-2026-0002"),
        &1,
        &hash(&p.env, 8),
        &None,
        &7200,
    );
    assert_eq!(p.estado(), EstadoLote::EnDisputa);
    // ...la corrección del laboratorio que lo certificó, sí.
    p.contrato.submit_analysis(
        &p.lab_a,
        &p.lote(),
        &p.vendedor,
        &texto(&p.env, ANALISIS),
        &2,
        &hash(&p.env, 2),
        &Some(hash(&p.env, 1)),
        &7200,
    );
    assert_eq!(p.estado(), EstadoLote::Certificado);
    p.contrato.list_batch(&p.vendedor, &p.lote(), &PRECIO);
    let venta = p.contrato.get_sale(&p.lote());
    assert_eq!((venta.pureza_bps, venta.version), (7200, 2));
}

#[test]
fn una_correccion_durante_la_garantia_no_cambia_lo_vendido() {
    let p = Prueba::nueva();
    p.certificar();
    p.publicar_y_comprar();
    p.contrato.submit_analysis(
        &p.lab_a,
        &p.lote(),
        &p.vendedor,
        &texto(&p.env, ANALISIS),
        &2,
        &hash(&p.env, 2),
        &Some(hash(&p.env, 1)),
        &7200,
    );
    // El contra-análisis se compara con los 75.00 % que se vendieron, no con la corrección.
    p.contrato.counter_analysis(&p.lab_b, &p.lote(), &hash(&p.env, 5), &7200);
    assert_eq!(p.estado(), EstadoLote::EnDisputa);
}

/// Error del host cuando falta la firma que pide `require_auth`.
fn falta_autorizacion() -> soroban_sdk::Error {
    soroban_sdk::Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
}

#[test]
fn llamadas_sin_la_autorizacion_correcta() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let lab = Address::generate(&env);
    let intruso = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let id = env.register(MinerTrace, (admin.clone(), sac.address(), TOLERANCIA_BPS, PLAZO_SEG));
    let contrato = MinerTraceClient::new(&env, &id);
    let nombre = texto(&env, "Laboratorio A");
    let firma_de = |firmante: &Address, fn_name: &'static str, args: soroban_sdk::Vec<Val>| {
        env.mock_auths(&[MockAuth {
            address: firmante,
            invoke: &MockAuthInvoke { contract: &id, fn_name, args, sub_invokes: &[] },
        }]);
    };

    // Sin ninguna firma, y firmado por alguien que no es el admin.
    assert_eq!(contrato.try_add_lab(&lab, &nombre), Err(Ok(falta_autorizacion())));
    firma_de(&intruso, "add_lab", (&lab, &nombre).into_val(&env));
    assert_eq!(contrato.try_add_lab(&lab, &nombre), Err(Ok(falta_autorizacion())));
    assert!(!contrato.is_lab(&lab));

    firma_de(&admin, "add_lab", (&lab, &nombre).into_val(&env));
    contrato.add_lab(&lab, &nombre);
    assert!(contrato.is_lab(&lab));

    // En las funciones con errores tipados, la falta de firma aborta la llamada.
    firma_de(&intruso, "revoke_lab", (&lab,).into_val(&env));
    assert_eq!(contrato.try_revoke_lab(&lab), Err(Err(InvokeError::Abort)));
    assert!(contrato.is_lab(&lab));

    // Un análisis a nombre del laboratorio firmado por otra cuenta.
    let lote = texto(&env, LOTE);
    let analisis = texto(&env, ANALISIS);
    let args = (&lab, &lote, &intruso, &analisis, 1_u32, hash(&env, 1), Option::<BytesN<32>>::None, 7500_u32);
    firma_de(&intruso, "submit_analysis", args.into_val(&env));
    assert_eq!(
        contrato.try_submit_analysis(&lab, &lote, &intruso, &analisis, &1, &hash(&env, 1), &None, &7500),
        Err(Err(InvokeError::Abort))
    );
    assert_eq!(contrato.try_get_batch(&lote), Err(Ok(Error::LoteInexistente)));

    // Con la firma correcta, el mismo análisis se registra.
    firma_de(&lab, "submit_analysis", args.into_val(&env));
    contrato.submit_analysis(&lab, &lote, &intruso, &analisis, &1, &hash(&env, 1), &None, &7500);
    assert_eq!(contrato.get_batch(&lote).estado, EstadoLote::Certificado);
}

#[test]
fn la_compra_exige_la_firma_del_comprador_tambien_para_el_pago() {
    let p = Prueba::nueva();
    p.certificar();
    p.contrato.list_batch(&p.vendedor, &p.lote(), &PRECIO);
    p.contrato.buy(&p.comprador, &p.lote());
    assert_eq!(
        p.env.auths(),
        std::vec![(
            p.comprador.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    p.id.clone(),
                    symbol_short!("buy"),
                    (p.comprador.clone(), p.lote()).into_val(&p.env),
                )),
                sub_invocations: std::vec![AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        p.token.address.clone(),
                        symbol_short!("transfer"),
                        (p.comprador.clone(), p.id.clone(), PRECIO).into_val(&p.env),
                    )),
                    sub_invocations: std::vec![],
                }],
            }
        )]
    );
}

#[test]
fn cada_accion_emite_un_evento() {
    let p = Prueba::nueva();
    let env = &p.env;
    let eventos = || env.events().all().filter_by_contract(&p.id);

    p.contrato.revoke_lab(&p.lab_b);
    assert_eq!(eventos(), [LaboratorioRevocado { lab: p.lab_b.clone(), nombre: texto(env, "Laboratorio B") }.to_xdr(env, &p.id)]);
    p.contrato.add_lab(&p.lab_b, &texto(env, "Laboratorio B"));
    assert_eq!(eventos(), [LaboratorioAgregado { lab: p.lab_b.clone(), nombre: texto(env, "Laboratorio B") }.to_xdr(env, &p.id)]);

    p.certificar();
    assert_eq!(
        eventos(),
        [AnalisisRegistrado {
            lote_id: p.lote(),
            analisis_id: texto(env, ANALISIS),
            version: 1,
            lab: p.lab_a.clone(),
            hash: hash(env, 1),
            pureza_bps: 7500,
        }
        .to_xdr(env, &p.id)]
    );

    p.contrato.list_batch(&p.vendedor, &p.lote(), &PRECIO);
    assert_eq!(
        eventos(),
        [LotePublicado { lote_id: p.lote(), vendedor: p.vendedor.clone(), precio: PRECIO, pureza_bps: 7500 }.to_xdr(env, &p.id)]
    );

    p.contrato.buy(&p.comprador, &p.lote());
    assert_eq!(
        eventos(),
        [LoteComprado { lote_id: p.lote(), comprador: p.comprador.clone(), precio: PRECIO }.to_xdr(env, &p.id)]
    );

    p.contrato.counter_analysis(&p.lab_b, &p.lote(), &hash(env, 5), &7000);
    assert_eq!(
        eventos(),
        [ContraAnalisisRegistrado {
            lote_id: p.lote(),
            lab: p.lab_b.clone(),
            hash: hash(env, 5),
            pureza_bps: 7000,
            diferencia_bps: 500,
            en_disputa: true,
        }
        .to_xdr(env, &p.id)]
    );

    p.contrato.refund(&p.comprador, &p.lote());
    assert_eq!(
        eventos(),
        [Reembolsado { lote_id: p.lote(), comprador: p.comprador.clone(), precio: PRECIO }.to_xdr(env, &p.id)]
    );

    // Confirmación en un segundo lote.
    let otro = texto(env, "LT-2026-0458");
    p.contrato.submit_analysis(&p.lab_a, &otro, &p.vendedor, &texto(env, "AN-2026-0009"), &1, &hash(env, 9), &None, &8000);
    p.contrato.list_batch(&p.vendedor, &otro, &PRECIO);
    p.contrato.buy(&p.comprador, &otro);
    p.contrato.confirm(&p.comprador, &otro);
    assert_eq!(
        eventos(),
        [VentaConfirmada { lote_id: otro, vendedor: p.vendedor.clone(), comprador: p.comprador.clone(), precio: PRECIO }
            .to_xdr(env, &p.id)]
    );
}

#[test]
fn el_vendedor_cobra_si_vence_el_plazo_sin_confirmacion() {
    let p = Prueba::nueva();
    p.env.ledger().with_mut(|l| l.timestamp = 1_000_000);
    p.certificar();
    p.publicar_y_comprar();
    let venta = p.contrato.get_sale(&p.lote());
    assert_eq!(venta.vence_garantia, Some(1_000_000 + PLAZO_SEG));

    // Antes de vencer, solo el comprador puede liberar el pago.
    assert_eq!(p.contrato.try_claim(&p.vendedor, &p.lote()), Err(Ok(Error::PlazoNoVencido)));
    p.env.ledger().with_mut(|l| l.timestamp = 1_000_000 + PLAZO_SEG - 1);
    assert_eq!(p.contrato.try_claim(&p.vendedor, &p.lote()), Err(Ok(Error::PlazoNoVencido)));

    p.env.ledger().with_mut(|l| l.timestamp = 1_000_000 + PLAZO_SEG);
    let extrano = Address::generate(&p.env);
    assert_eq!(p.contrato.try_claim(&extrano, &p.lote()), Err(Ok(Error::NoEsVendedor)));
    assert_eq!(p.contrato.try_claim(&p.comprador, &p.lote()), Err(Ok(Error::NoEsVendedor)));

    p.contrato.claim(&p.vendedor, &p.lote());
    assert_eq!(
        p.env.events().all().filter_by_contract(&p.id),
        [PagoReclamado { lote_id: p.lote(), vendedor: p.vendedor.clone(), comprador: p.comprador.clone(), precio: PRECIO }
            .to_xdr(&p.env, &p.id)]
    );
    let lote = p.contrato.get_batch(&p.lote());
    assert_eq!((lote.estado, lote.dueno), (EstadoLote::Vendido, p.comprador.clone()));
    assert_eq!(p.token.balance(&p.vendedor), PRECIO);
    assert_eq!(p.token.balance(&p.id), 0);
    assert_eq!(p.contrato.try_claim(&p.vendedor, &p.lote()), Err(Ok(Error::LoteNoDisponible)));
    assert_eq!(p.contrato.try_confirm(&p.comprador, &p.lote()), Err(Ok(Error::LoteNoDisponible)));
}

#[test]
fn en_disputa_el_vendedor_no_cobra_aunque_venza_el_plazo() {
    let p = Prueba::nueva();
    p.certificar();
    p.publicar_y_comprar();
    p.contrato.counter_analysis(&p.lab_b, &p.lote(), &hash(&p.env, 5), &7000);
    p.env.ledger().with_mut(|l| l.timestamp += PLAZO_SEG * 2);
    assert_eq!(p.contrato.try_claim(&p.vendedor, &p.lote()), Err(Ok(Error::LoteEnDisputa)));
    // El comprador sigue pudiendo recuperar su dinero.
    p.contrato.refund(&p.comprador, &p.lote());
    assert_eq!(p.token.balance(&p.comprador), 2 * PRECIO);
}

#[test]
fn el_plazo_se_guarda_en_la_configuracion() {
    let p = Prueba::nueva();
    let config = p.contrato.get_config();
    assert_eq!((config.tolerancia_bps, config.plazo_garantia_seg), (TOLERANCIA_BPS, PLAZO_SEG));
    // Sin compra no hay vencimiento.
    p.certificar();
    p.contrato.list_batch(&p.vendedor, &p.lote(), &PRECIO);
    assert_eq!(p.contrato.get_sale(&p.lote()).vence_garantia, None);
    assert_eq!(p.contrato.try_claim(&p.vendedor, &p.lote()), Err(Ok(Error::LoteNoDisponible)));
}
