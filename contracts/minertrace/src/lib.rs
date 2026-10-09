#![no_std]
// submit_analysis recibe 9 argumentos: es la interfaz pública acordada del contrato.
#![allow(clippy::too_many_arguments)]
//! MinerTrace: registro de análisis minerales y marketplace con pago en garantía.
//!
//! - Los laboratorios autorizados por el administrador registran el hash
//!   SHA-256 de cada análisis (el mismo que calcula `server/src/integridad/canonico.ts`).
//!   Las versiones nunca se sobrescriben: una corrección es la versión N+1 y
//!   debe apuntar al hash de la versión N.
//! - El dueño de un lote certificado puede publicarlo; el comprador paga al
//!   contrato, que retiene el dinero hasta que confirma la recepción. Otro
//!   laboratorio puede registrar un contra-análisis: si la pureza difiere más
//!   que la tolerancia, el lote entra en disputa y el comprador recupera su dinero.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token, Address,
    BytesN, Env, IntoVal, String, Val, Vec,
};

/// Un ledger cada ~5 segundos.
const LEDGERS_POR_DIA: u32 = 17_280;
/// En cada escritura, si a la entrada le quedan menos de 30 días se extiende a 120.
const UMBRAL_TTL: u32 = 30 * LEDGERS_POR_DIA;
const EXTENSION_TTL: u32 = 120 * LEDGERS_POR_DIA;
/// 100 % expresado en puntos básicos.
const PUREZA_MAX_BPS: u32 = 10_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// El laboratorio no está registrado o fue revocado.
    LaboratorioNoAutorizado = 1,
    LaboratorioInexistente = 2,
    /// La pureza supera 10000 puntos básicos (100 %).
    PurezaInvalida = 3,
    ToleranciaInvalida = 4,
    /// La versión 0 no existe: se numeran desde 1.
    VersionInvalida = 5,
    VersionDuplicada = 6,
    VersionAnteriorInexistente = 7,
    HashAnteriorIncorrecto = 8,
    /// Una versión nueva solo la puede registrar el laboratorio de la anterior.
    LaboratorioDistinto = 9,
    /// Una versión nueva debe pertenecer al mismo lote que la anterior.
    LoteDistinto = 10,
    AnalisisInexistente = 11,
    LoteInexistente = 12,
    NoEsDueno = 13,
    /// El estado del lote no permite la operación.
    LoteNoDisponible = 14,
    /// El laboratorio que certificó el lote fue revocado.
    AnalisisNoValido = 15,
    PrecioInvalido = 16,
    CompradorEsVendedor = 17,
    /// El contra-análisis debe hacerlo un laboratorio distinto del que certificó el lote.
    MismoLaboratorio = 18,
    ContraAnalisisExistente = 19,
    NoEsComprador = 20,
    LoteEnDisputa = 21,
    SinVenta = 22,
    SinContraAnalisis = 23,
    /// El plazo de la garantía debe ser mayor que cero.
    PlazoInvalido = 24,
    /// El vendedor solo cobra sin confirmación cuando vence el plazo de la garantía.
    PlazoNoVencido = 25,
    NoEsVendedor = 26,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EstadoLote {
    Certificado,
    EnVenta,
    EnGarantia,
    EnDisputa,
    Vendido,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    /// Contrato de token (interfaz estándar): XLM nativo en testnet, USDC u otro por configuración.
    pub token: Address,
    /// Diferencia máxima de pureza aceptada en un contra-análisis, en puntos básicos.
    pub tolerancia_bps: u32,
    /// Si el comprador no confirma ni hay disputa en este plazo (segundos), el vendedor puede cobrar.
    pub plazo_garantia_seg: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Laboratorio {
    pub nombre: String,
    pub activo: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Analisis {
    pub lab: Address,
    pub lote_id: String,
    pub hash: BytesN<32>,
    pub hash_anterior: Option<BytesN<32>>,
    pub pureza_bps: u32,
    pub ledger: u32,
    /// Hora de cierre del ledger (segundos Unix).
    pub fecha: u64,
}

/// Venta en curso. El análisis que certifica la pureza se copia al publicar:
/// una corrección posterior no cambia lo que se vendió.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Venta {
    pub vendedor: Address,
    pub precio: i128,
    pub comprador: Option<Address>,
    pub analisis_id: String,
    pub version: u32,
    pub lab: Address,
    pub pureza_bps: u32,
    /// Momento (segundos Unix) a partir del cual el vendedor puede cobrar; se fija al comprar.
    pub vence_garantia: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContraAnalisis {
    pub lab: Address,
    /// Laboratorio cuyo resultado se puso a prueba (el de la venta). Tras un
    /// reembolso, solo un análisis nuevo suyo desbloquea el lote.
    pub lab_certificador: Address,
    pub hash: BytesN<32>,
    pub pureza_bps: u32,
    pub diferencia_bps: u32,
    pub fecha: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Lote {
    pub dueno: Address,
    pub estado: EstadoLote,
    /// Último análisis registrado: el que certifica la pureza del lote.
    pub analisis_id: String,
    pub version: u32,
    pub lab: Address,
    pub pureza_bps: u32,
}

// La venta en curso y el contra-análisis van en claves propias (no como
// campos opcionales de `Lote`): get_sale y get_counter_analysis.
#[contracttype]
#[derive(Clone)]
enum Clave {
    Config,
    Laboratorio(Address),
    Analisis(String, u32),
    Lote(String),
    Venta(String),
    /// Se conserva tras la venta o el reembolso; se borra al volver a publicar.
    ContraAnalisis(String),
    LotesEnVenta,
}

// Eventos: el primer tema es el nombre del struct en snake_case.

#[contractevent]
pub struct Configurado {
    pub admin: Address,
    pub token: Address,
    pub tolerancia_bps: u32,
    pub plazo_garantia_seg: u64,
}

#[contractevent]
pub struct LaboratorioAgregado {
    #[topic]
    pub lab: Address,
    pub nombre: String,
}

#[contractevent]
pub struct LaboratorioRevocado {
    #[topic]
    pub lab: Address,
    pub nombre: String,
}

#[contractevent]
pub struct AnalisisRegistrado {
    #[topic]
    pub lote_id: String,
    #[topic]
    pub analisis_id: String,
    pub version: u32,
    pub lab: Address,
    pub hash: BytesN<32>,
    pub pureza_bps: u32,
}

#[contractevent]
pub struct LotePublicado {
    #[topic]
    pub lote_id: String,
    pub vendedor: Address,
    pub precio: i128,
    pub pureza_bps: u32,
}

#[contractevent]
pub struct LoteComprado {
    #[topic]
    pub lote_id: String,
    pub comprador: Address,
    pub precio: i128,
}

#[contractevent]
pub struct ContraAnalisisRegistrado {
    #[topic]
    pub lote_id: String,
    pub lab: Address,
    pub hash: BytesN<32>,
    pub pureza_bps: u32,
    pub diferencia_bps: u32,
    pub en_disputa: bool,
}

#[contractevent]
pub struct VentaConfirmada {
    #[topic]
    pub lote_id: String,
    pub vendedor: Address,
    pub comprador: Address,
    pub precio: i128,
}

#[contractevent]
pub struct PagoReclamado {
    #[topic]
    pub lote_id: String,
    pub vendedor: Address,
    pub comprador: Address,
    pub precio: i128,
}

#[contractevent]
pub struct Reembolsado {
    #[topic]
    pub lote_id: String,
    pub comprador: Address,
    pub precio: i128,
}

fn config(env: &Env) -> Config {
    // El constructor la guarda al desplegar, así que siempre existe.
    env.storage().instance().get(&Clave::Config).unwrap()
}

/// Escritura persistente con extensión del TTL de la entrada y de la instancia.
fn guardar<V: IntoVal<Env, Val>>(env: &Env, clave: &Clave, valor: &V) {
    let persistente = env.storage().persistent();
    persistente.set(clave, valor);
    persistente.extend_ttl(clave, UMBRAL_TTL, EXTENSION_TTL);
    env.storage().instance().extend_ttl(UMBRAL_TTL, EXTENSION_TTL);
}

fn leer_laboratorio(env: &Env, lab: &Address) -> Option<Laboratorio> {
    env.storage().persistent().get(&Clave::Laboratorio(lab.clone()))
}

fn lab_activo(env: &Env, lab: &Address) -> bool {
    leer_laboratorio(env, lab).is_some_and(|l| l.activo)
}

fn leer_lote(env: &Env, lote_id: &String) -> Result<Lote, Error> {
    env.storage()
        .persistent()
        .get(&Clave::Lote(lote_id.clone()))
        .ok_or(Error::LoteInexistente)
}

fn guardar_lote(env: &Env, lote_id: &String, lote: &Lote) {
    guardar(env, &Clave::Lote(lote_id.clone()), lote);
}

fn leer_venta(env: &Env, lote_id: &String) -> Option<Venta> {
    env.storage().persistent().get(&Clave::Venta(lote_id.clone()))
}

fn leer_contra_analisis(env: &Env, lote_id: &String) -> Option<ContraAnalisis> {
    env.storage().persistent().get(&Clave::ContraAnalisis(lote_id.clone()))
}

fn borrar(env: &Env, clave: &Clave) {
    env.storage().persistent().remove(clave);
    env.storage().instance().extend_ttl(UMBRAL_TTL, EXTENSION_TTL);
}

fn lotes_en_venta(env: &Env) -> Vec<String> {
    env.storage()
        .persistent()
        .get(&Clave::LotesEnVenta)
        .unwrap_or_else(|| Vec::new(env))
}

fn quitar_de_venta(env: &Env, lote_id: &String) {
    let mut lotes = lotes_en_venta(env);
    if let Some(i) = lotes.first_index_of(lote_id) {
        lotes.remove(i);
        guardar(env, &Clave::LotesEnVenta, &lotes);
    }
}

fn transferir(env: &Env, desde: &Address, hacia: &Address, monto: i128) {
    token::Client::new(env, &config(env).token).transfer(desde, hacia, &monto);
}

/// Lote en garantía (sin disputa) con su venta en curso.
fn venta_en_garantia(env: &Env, lote_id: &String) -> Result<(Lote, Venta), Error> {
    let lote = leer_lote(env, lote_id)?;
    match lote.estado {
        EstadoLote::EnGarantia => {}
        EstadoLote::EnDisputa => return Err(Error::LoteEnDisputa),
        _ => return Err(Error::LoteNoDisponible),
    }
    let venta = leer_venta(env, lote_id).ok_or(Error::LoteNoDisponible)?;
    Ok((lote, venta))
}

/// Paga al vendedor lo retenido y entrega el lote al comprador.
fn liquidar(env: &Env, lote_id: &String, mut lote: Lote, venta: &Venta, comprador: &Address) {
    transferir(env, &env.current_contract_address(), &venta.vendedor, venta.precio);
    lote.dueno = comprador.clone();
    lote.estado = EstadoLote::Vendido;
    guardar_lote(env, lote_id, &lote);
    borrar(env, &Clave::Venta(lote_id.clone()));
}

#[contract]
pub struct MinerTrace;

#[contractimpl]
impl MinerTrace {
    /// Se ejecuta una sola vez, en la misma transacción del despliegue.
    pub fn __constructor(env: Env, admin: Address, token: Address, tolerancia_bps: u32, plazo_garantia_seg: u64) {
        if tolerancia_bps > PUREZA_MAX_BPS {
            panic_with_error!(&env, Error::ToleranciaInvalida);
        }
        if plazo_garantia_seg == 0 {
            panic_with_error!(&env, Error::PlazoInvalido);
        }
        env.storage().instance().set(
            &Clave::Config,
            &Config { admin: admin.clone(), token: token.clone(), tolerancia_bps, plazo_garantia_seg },
        );
        env.storage().instance().extend_ttl(UMBRAL_TTL, EXTENSION_TTL);
        Configurado { admin, token, tolerancia_bps, plazo_garantia_seg }.publish(&env);
    }

    pub fn get_config(env: Env) -> Config {
        config(&env)
    }

    // ---- Laboratorios ----

    pub fn add_lab(env: Env, lab: Address, nombre: String) {
        config(&env).admin.require_auth();
        guardar(
            &env,
            &Clave::Laboratorio(lab.clone()),
            &Laboratorio { nombre: nombre.clone(), activo: true },
        );
        LaboratorioAgregado { lab, nombre }.publish(&env);
    }

    pub fn revoke_lab(env: Env, lab: Address) -> Result<(), Error> {
        config(&env).admin.require_auth();
        let mut laboratorio = leer_laboratorio(&env, &lab).ok_or(Error::LaboratorioInexistente)?;
        laboratorio.activo = false;
        guardar(&env, &Clave::Laboratorio(lab.clone()), &laboratorio);
        LaboratorioRevocado { lab, nombre: laboratorio.nombre }.publish(&env);
        Ok(())
    }

    pub fn is_lab(env: Env, lab: Address) -> bool {
        lab_activo(&env, &lab)
    }

    pub fn get_lab(env: Env, lab: Address) -> Option<Laboratorio> {
        leer_laboratorio(&env, &lab)
    }

    // ---- Análisis ----

    /// Registra la versión `version` de un análisis. La versión 1 crea el lote
    /// con su dueño si aún no existe; si existe, `dueno` se ignora (el dueño
    /// actual puede ser otro tras una venta).
    pub fn submit_analysis(
        env: Env,
        lab: Address,
        lote_id: String,
        dueno: Address,
        analisis_id: String,
        version: u32,
        hash: BytesN<32>,
        hash_anterior: Option<BytesN<32>>,
        pureza_bps: u32,
    ) -> Result<(), Error> {
        lab.require_auth();
        if !lab_activo(&env, &lab) {
            return Err(Error::LaboratorioNoAutorizado);
        }
        if pureza_bps > PUREZA_MAX_BPS {
            return Err(Error::PurezaInvalida);
        }
        if version == 0 {
            return Err(Error::VersionInvalida);
        }
        let clave = Clave::Analisis(analisis_id.clone(), version);
        if env.storage().persistent().has(&clave) {
            return Err(Error::VersionDuplicada);
        }

        if version == 1 {
            if hash_anterior.is_some() {
                return Err(Error::HashAnteriorIncorrecto);
            }
        } else {
            let anterior: Analisis = env
                .storage()
                .persistent()
                .get(&Clave::Analisis(analisis_id.clone(), version - 1))
                .ok_or(Error::VersionAnteriorInexistente)?;
            if hash_anterior != Some(anterior.hash) {
                return Err(Error::HashAnteriorIncorrecto);
            }
            if anterior.lab != lab {
                return Err(Error::LaboratorioDistinto);
            }
            if anterior.lote_id != lote_id {
                return Err(Error::LoteDistinto);
            }
        }

        let lote = match leer_lote(&env, &lote_id) {
            Ok(mut lote) => {
                // Tras un reembolso por disputa, el lote se desbloquea cuando el
                // laboratorio cuyo resultado se discutió registra un análisis nuevo.
                let reembolsado = lote.estado == EstadoLote::EnDisputa && leer_venta(&env, &lote_id).is_none();
                let es_certificador = leer_contra_analisis(&env, &lote_id).is_some_and(|c| c.lab_certificador == lab);
                if reembolsado && es_certificador {
                    lote.estado = EstadoLote::Certificado;
                }
                lote.analisis_id = analisis_id.clone();
                lote.version = version;
                lote.lab = lab.clone();
                lote.pureza_bps = pureza_bps;
                lote
            }
            Err(_) => Lote {
                dueno,
                estado: EstadoLote::Certificado,
                analisis_id: analisis_id.clone(),
                version,
                lab: lab.clone(),
                pureza_bps,
            },
        };

        guardar(
            &env,
            &clave,
            &Analisis {
                lab: lab.clone(),
                lote_id: lote_id.clone(),
                hash: hash.clone(),
                hash_anterior,
                pureza_bps,
                ledger: env.ledger().sequence(),
                fecha: env.ledger().timestamp(),
            },
        );
        guardar_lote(&env, &lote_id, &lote);
        AnalisisRegistrado { lote_id, analisis_id, version, lab, hash, pureza_bps }.publish(&env);
        Ok(())
    }

    pub fn get_analysis(env: Env, analisis_id: String, version: u32) -> Result<Analisis, Error> {
        env.storage()
            .persistent()
            .get(&Clave::Analisis(analisis_id, version))
            .ok_or(Error::AnalisisInexistente)
    }

    pub fn get_batch(env: Env, lote_id: String) -> Result<Lote, Error> {
        leer_lote(&env, &lote_id)
    }

    /// Venta en curso del lote (publicada, en garantía o en disputa sin reembolsar).
    pub fn get_sale(env: Env, lote_id: String) -> Result<Venta, Error> {
        leer_venta(&env, &lote_id).ok_or(Error::SinVenta)
    }

    /// Contra-análisis de la última venta del lote.
    pub fn get_counter_analysis(env: Env, lote_id: String) -> Result<ContraAnalisis, Error> {
        leer_contra_analisis(&env, &lote_id).ok_or(Error::SinContraAnalisis)
    }

    /// Códigos de los lotes publicados que aún no tienen comprador.
    pub fn listed_batches(env: Env) -> Vec<String> {
        lotes_en_venta(&env)
    }

    // ---- Marketplace con garantía ----

    pub fn list_batch(env: Env, dueno: Address, lote_id: String, precio: i128) -> Result<(), Error> {
        dueno.require_auth();
        let mut lote = leer_lote(&env, &lote_id)?;
        if lote.dueno != dueno {
            return Err(Error::NoEsDueno);
        }
        match lote.estado {
            EstadoLote::Certificado | EstadoLote::Vendido => {}
            EstadoLote::EnDisputa => return Err(Error::LoteEnDisputa),
            _ => return Err(Error::LoteNoDisponible),
        }
        if precio <= 0 {
            return Err(Error::PrecioInvalido);
        }
        if !lab_activo(&env, &lote.lab) {
            return Err(Error::AnalisisNoValido);
        }

        let venta = Venta {
            vendedor: dueno.clone(),
            precio,
            comprador: None,
            analisis_id: lote.analisis_id.clone(),
            version: lote.version,
            lab: lote.lab.clone(),
            pureza_bps: lote.pureza_bps,
            vence_garantia: None,
        };
        guardar(&env, &Clave::Venta(lote_id.clone()), &venta);
        borrar(&env, &Clave::ContraAnalisis(lote_id.clone()));
        lote.estado = EstadoLote::EnVenta;
        guardar_lote(&env, &lote_id, &lote);

        let mut en_venta = lotes_en_venta(&env);
        en_venta.push_back(lote_id.clone());
        guardar(&env, &Clave::LotesEnVenta, &en_venta);

        LotePublicado { lote_id, vendedor: dueno, precio, pureza_bps: venta.pureza_bps }.publish(&env);
        Ok(())
    }

    /// El precio pasa del comprador al contrato, que lo retiene en garantía.
    pub fn buy(env: Env, comprador: Address, lote_id: String) -> Result<(), Error> {
        comprador.require_auth();
        let mut lote = leer_lote(&env, &lote_id)?;
        if lote.estado != EstadoLote::EnVenta {
            return Err(Error::LoteNoDisponible);
        }
        let mut venta = leer_venta(&env, &lote_id).ok_or(Error::LoteNoDisponible)?;
        if venta.vendedor == comprador {
            return Err(Error::CompradorEsVendedor);
        }

        transferir(&env, &comprador, &env.current_contract_address(), venta.precio);

        venta.comprador = Some(comprador.clone());
        venta.vence_garantia = Some(env.ledger().timestamp() + config(&env).plazo_garantia_seg);
        guardar(&env, &Clave::Venta(lote_id.clone()), &venta);
        lote.estado = EstadoLote::EnGarantia;
        guardar_lote(&env, &lote_id, &lote);
        quitar_de_venta(&env, &lote_id);

        LoteComprado { lote_id, comprador, precio: venta.precio }.publish(&env);
        Ok(())
    }

    /// Un laboratorio distinto del que certificó el lote mide de nuevo la pureza.
    /// Si la diferencia supera la tolerancia, el lote pasa a disputa.
    pub fn counter_analysis(
        env: Env,
        lab: Address,
        lote_id: String,
        hash: BytesN<32>,
        pureza_bps: u32,
    ) -> Result<(), Error> {
        lab.require_auth();
        if !lab_activo(&env, &lab) {
            return Err(Error::LaboratorioNoAutorizado);
        }
        if pureza_bps > PUREZA_MAX_BPS {
            return Err(Error::PurezaInvalida);
        }
        let mut lote = leer_lote(&env, &lote_id)?;
        if leer_contra_analisis(&env, &lote_id).is_some() {
            return Err(Error::ContraAnalisisExistente);
        }
        if lote.estado != EstadoLote::EnGarantia {
            return Err(Error::LoteNoDisponible);
        }
        let venta = leer_venta(&env, &lote_id).ok_or(Error::LoteNoDisponible)?;
        if venta.lab == lab {
            return Err(Error::MismoLaboratorio);
        }

        let diferencia_bps = pureza_bps.abs_diff(venta.pureza_bps);
        let en_disputa = diferencia_bps > config(&env).tolerancia_bps;
        guardar(
            &env,
            &Clave::ContraAnalisis(lote_id.clone()),
            &ContraAnalisis {
                lab: lab.clone(),
                lab_certificador: venta.lab,
                hash: hash.clone(),
                pureza_bps,
                diferencia_bps,
                fecha: env.ledger().timestamp(),
            },
        );
        if en_disputa {
            lote.estado = EstadoLote::EnDisputa;
            guardar_lote(&env, &lote_id, &lote);
        }

        ContraAnalisisRegistrado { lote_id, lab, hash, pureza_bps, diferencia_bps, en_disputa }.publish(&env);
        Ok(())
    }

    /// El comprador confirma: el vendedor cobra y el lote cambia de dueño.
    pub fn confirm(env: Env, comprador: Address, lote_id: String) -> Result<(), Error> {
        comprador.require_auth();
        let (lote, venta) = venta_en_garantia(&env, &lote_id)?;
        if venta.comprador.as_ref() != Some(&comprador) {
            return Err(Error::NoEsComprador);
        }
        liquidar(&env, &lote_id, lote, &venta, &comprador);
        VentaConfirmada { lote_id, vendedor: venta.vendedor, comprador, precio: venta.precio }.publish(&env);
        Ok(())
    }

    /// Vencido el plazo de la garantía sin confirmación ni disputa, el vendedor
    /// cobra y el lote pasa al comprador, igual que si hubiera confirmado.
    pub fn claim(env: Env, vendedor: Address, lote_id: String) -> Result<(), Error> {
        vendedor.require_auth();
        let (lote, venta) = venta_en_garantia(&env, &lote_id)?;
        if venta.vendedor != vendedor {
            return Err(Error::NoEsVendedor);
        }
        let vence = venta.vence_garantia.ok_or(Error::LoteNoDisponible)?;
        if env.ledger().timestamp() < vence {
            return Err(Error::PlazoNoVencido);
        }
        let comprador = venta.comprador.clone().ok_or(Error::LoteNoDisponible)?;
        liquidar(&env, &lote_id, lote, &venta, &comprador);
        PagoReclamado { lote_id, vendedor, comprador, precio: venta.precio }.publish(&env);
        Ok(())
    }

    /// Solo en disputa: el comprador recupera el dinero y el lote sigue bloqueado
    /// hasta que el laboratorio que lo certificó registre un análisis nuevo.
    pub fn refund(env: Env, comprador: Address, lote_id: String) -> Result<(), Error> {
        comprador.require_auth();
        let lote = leer_lote(&env, &lote_id)?;
        if lote.estado != EstadoLote::EnDisputa {
            return Err(Error::LoteNoDisponible);
        }
        let venta = leer_venta(&env, &lote_id).ok_or(Error::LoteNoDisponible)?;
        if venta.comprador.as_ref() != Some(&comprador) {
            return Err(Error::NoEsComprador);
        }

        transferir(&env, &env.current_contract_address(), &comprador, venta.precio);
        borrar(&env, &Clave::Venta(lote_id.clone()));

        Reembolsado { lote_id, comprador, precio: venta.precio }.publish(&env);
        Ok(())
    }
}

mod test;
