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
//!   que la tolerancia, el lote entra en disputa. Un reembolso exige acreditar
//!   la devolución del metal. Las incidencias físicas tienen arbitraje explícito.

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, BytesN, Env, IntoVal, Map, String, Symbol, TryFromVal, Val, Vec,
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
    ConfiguracionComercialInvalida = 27,
    ImporteFueraDeRango = 28,
    PublicacionVencida = 29,
    OrdenInvalida = 30,
    OrdenReutilizada = 31,
    CompradorNoReservado = 32,
    EvidenciaInvalida = 33,
    SinVentaComercial = 34,
    GastoEnsayoExistente = 35,
    ComprobanteReutilizado = 36,
    RecepcionExistente = 37,
    SinRecepcion = 38,
    IncidenciaExistente = 39,
    MotivoInvalido = 40,
    DevolucionNoAcreditada = 41,
    PlazoEntregaNoVencido = 42,
    SinLiquidacion = 43,
    NoEsAdministrador = 44,
    GarantiaVencida = 45,
    CotizacionDesactualizada = 46,
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
    /// Plazo de inspección (segundos) desde la recepción: vencido sin disputa, el vendedor puede cobrar.
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
    /// Vencimiento de garantía: se fija al acreditar la recepción, nunca al comprar.
    pub vence_garantia: Option<u64>,
}

/// Importes en unidades mínimas del token configurado. No presupone una moneda ni sus decimales.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigComercial {
    pub version: u32,
    pub destinatario_plataforma: Address,
    pub comision_bps: u32,
    pub comision_minima: i128,
    pub reintegro_bps: u32,
    pub reintegro_maximo: i128,
    pub plazo_entrega_seg: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GastoEnsayo {
    pub lab: Address,
    pub costo: i128,
    pub comprobante_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Recepcion {
    pub fecha: u64,
    pub evidencia_hash: BytesN<32>,
    /// Comprador que reconoce recepción o laboratorio certificador que atestigua entrega.
    pub acreditador: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Incidencia {
    pub motivo: String,
    pub fecha: u64,
}

/// Condiciones y desglose congelados al publicar o reservar. No modifica el registro canónico del análisis.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VentaComercial {
    pub version: u32,
    pub orden_id: Option<String>,
    pub comprador_reservado: Option<Address>,
    pub vence_publicacion: Option<u64>,
    pub condiciones_hash: Option<BytesN<32>>,
    pub destinatario_plataforma: Address,
    pub comision_bps: u32,
    pub comision: i128,
    pub reintegro: i128,
    pub total: i128,
    pub plazo_entrega_seg: u64,
    pub plazo_garantia_seg: u64,
    pub vence_entrega: Option<u64>,
    /// Mapa de Recepcion: conserva la representación objeto/null y evita el fallo de SDK28 con Option<struct>.
    pub recepcion: Option<Map<Symbol, Val>>,
    /// Mapa de Incidencia con motivo y fecha.
    pub incidencia: Option<Map<Symbol, Val>>,
    pub devolucion_hash: Option<BytesN<32>>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ResultadoLiquidacion {
    Pagada,
    Reembolsada,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Liquidacion {
    pub numero: u32,
    pub vendedor: Address,
    pub comprador: Address,
    pub precio: i128,
    pub comision: i128,
    pub reintegro: i128,
    pub total: i128,
    pub recibido_vendedor: i128,
    pub recibido_plataforma: i128,
    pub devuelto_comprador: i128,
    pub resultado: ResultadoLiquidacion,
    pub fecha: u64,
    pub comercial: VentaComercial,
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
    Comercio,
    Laboratorio(Address),
    Analisis(String, u32),
    Lote(String),
    Venta(String),
    VentaComercial(String),
    GastoEnsayo(String),
    ComprobanteUsado(BytesN<32>),
    ReintegroPagado(String),
    OrdenUsada(String),
    OrdenCancelada(String),
    Liquidaciones(String),
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

#[contractevent]
pub struct ComercioConfigurado {
    pub configuracion: ConfigComercial,
}

#[contractevent]
pub struct VentaReservada {
    #[topic]
    pub lote_id: String,
    pub orden_id: String,
    pub vendedor: Address,
    pub comprador: Address,
    pub precio: i128,
    pub comision: i128,
    pub reintegro: i128,
    pub total: i128,
    pub vence_publicacion: u64,
    pub condiciones_hash: BytesN<32>,
}

#[contractevent]
pub struct VentaCancelada {
    #[topic]
    pub lote_id: String,
    pub vendedor: Address,
}

#[contractevent]
pub struct GastoEnsayoRegistrado {
    #[topic]
    pub lote_id: String,
    pub lab: Address,
    pub costo: i128,
    pub comprobante_hash: BytesN<32>,
}

#[contractevent]
pub struct RecepcionRegistrada {
    #[topic]
    pub lote_id: String,
    pub acreditador: Address,
    pub evidencia_hash: BytesN<32>,
    pub vence_garantia: u64,
}

#[contractevent]
pub struct IncidenciaAbierta {
    #[topic]
    pub lote_id: String,
    pub comprador: Address,
    pub motivo: String,
}

#[contractevent]
pub struct DevolucionRegistrada {
    #[topic]
    pub lote_id: String,
    pub lab: Address,
    pub evidencia_hash: BytesN<32>,
}

#[contractevent]
pub struct VentaLiquidada {
    #[topic]
    pub lote_id: String,
    pub orden_id: Option<String>,
    pub numero: u32,
    pub vendedor: Address,
    pub comprador: Address,
    pub precio: i128,
    pub comision: i128,
    pub reintegro: i128,
    pub recibido_vendedor: i128,
    pub recibido_plataforma: i128,
    pub devuelto_comprador: i128,
    pub resultado: ResultadoLiquidacion,
}

fn config(env: &Env) -> Config {
    // El constructor la guarda al desplegar, así que siempre existe.
    env.storage().instance().get(&Clave::Config).unwrap()
}

fn comercio(env: &Env) -> Option<ConfigComercial> {
    env.storage().persistent().get(&Clave::Comercio)
}

fn leer_comercial(env: &Env, lote_id: &String) -> Result<VentaComercial, Error> {
    env.storage()
        .persistent()
        .get(&Clave::VentaComercial(lote_id.clone()))
        .ok_or(Error::SinVentaComercial)
}

fn evidencia_valida(hash: &BytesN<32>) -> bool {
    hash.to_array() != [0; 32]
}

fn como_mapa<T: IntoVal<Env, Val>>(env: &Env, valor: T) -> Map<Symbol, Val> {
    Map::try_from_val(env, &valor.into_val(env)).unwrap()
}

/// Evita multiplicar el importe completo: incluso i128::MAX puede cotizarse sin desbordar.
fn proporcion(importe: i128, bps: u32, redondear_arriba: bool) -> Result<i128, Error> {
    let resto = (importe % 10_000) * i128::from(bps);
    let base = (importe / 10_000)
        .checked_mul(i128::from(bps))
        .ok_or(Error::ImporteFueraDeRango)?;
    base.checked_add(resto / 10_000)
        .and_then(|n| n.checked_add(i128::from(redondear_arriba && resto % 10_000 != 0)))
        .ok_or(Error::ImporteFueraDeRango)
}

fn condiciones_comerciales(
    env: &Env,
    lote_id: &String,
    venta: &Venta,
) -> Result<VentaComercial, Error> {
    let configuracion = comercio(env);
    let (destinatario, bps, minimo, reintegro_bps, maximo, plazo) = match configuracion {
        Some(c) => (
            c.destinatario_plataforma,
            c.comision_bps,
            c.comision_minima,
            c.reintegro_bps,
            c.reintegro_maximo,
            c.plazo_entrega_seg,
        ),
        // Mantiene la interfaz de despliegue y las ventas sin comisión hasta configurar el comercio.
        None => (config(env).admin, 0, 0, 0, 0, 86_400),
    };
    let comision = proporcion(venta.precio, bps, true)?.max(minimo);
    let total = venta
        .precio
        .checked_add(comision)
        .ok_or(Error::ImporteFueraDeRango)?;
    let pagado = env
        .storage()
        .persistent()
        .get::<_, bool>(&Clave::ReintegroPagado(lote_id.clone()))
        .unwrap_or(false);
    let gasto: Option<GastoEnsayo> = env
        .storage()
        .persistent()
        .get(&Clave::GastoEnsayo(lote_id.clone()));
    let reintegro = match gasto {
        Some(g) if !pagado && g.lab == venta.lab => proporcion(venta.precio, reintegro_bps, false)?
            .min(g.costo)
            .min(maximo)
            .min(comision),
        _ => 0,
    };
    // También verifica ahora que el vendedor podrá recibir precio + incentivo.
    venta
        .precio
        .checked_add(reintegro)
        .ok_or(Error::ImporteFueraDeRango)?;
    Ok(VentaComercial {
        version: 2,
        orden_id: None,
        comprador_reservado: None,
        vence_publicacion: None,
        condiciones_hash: None,
        destinatario_plataforma: destinatario,
        comision_bps: bps,
        comision,
        reintegro,
        total,
        plazo_entrega_seg: plazo,
        plazo_garantia_seg: config(env).plazo_garantia_seg,
        vence_entrega: None,
        recepcion: None,
        incidencia: None,
        devolucion_hash: None,
    })
}

fn historial_liquidaciones(env: &Env, lote_id: &String) -> Vec<Liquidacion> {
    env.storage()
        .persistent()
        .get(&Clave::Liquidaciones(lote_id.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

fn guardar_liquidacion(
    env: &Env,
    lote_id: &String,
    venta: &Venta,
    comercial: &VentaComercial,
    comprador: &Address,
    pagada: bool,
) {
    let mut historial = historial_liquidaciones(env, lote_id);
    let numero = historial.len() + 1;
    let resultado = if pagada {
        ResultadoLiquidacion::Pagada
    } else {
        ResultadoLiquidacion::Reembolsada
    };
    let reintegro = if pagada { comercial.reintegro } else { 0 };
    let recibido_vendedor = if pagada { venta.precio + reintegro } else { 0 };
    let recibido_plataforma = if pagada {
        comercial.comision - reintegro
    } else {
        0
    };
    let devuelto_comprador = if pagada { 0 } else { comercial.total };
    historial.push_back(Liquidacion {
        numero,
        vendedor: venta.vendedor.clone(),
        comprador: comprador.clone(),
        precio: venta.precio,
        comision: comercial.comision,
        reintegro,
        total: comercial.total,
        recibido_vendedor,
        recibido_plataforma,
        devuelto_comprador,
        resultado: resultado.clone(),
        fecha: env.ledger().timestamp(),
        comercial: comercial.clone(),
    });
    guardar(env, &Clave::Liquidaciones(lote_id.clone()), &historial);
    // Solo las ventas con comercio configurado añaden este evento al flujo histórico anterior.
    if comercial.comision_bps != 0 || comercial.orden_id.is_some() {
        VentaLiquidada {
            lote_id: lote_id.clone(),
            orden_id: comercial.orden_id.clone(),
            numero,
            vendedor: venta.vendedor.clone(),
            comprador: comprador.clone(),
            precio: venta.precio,
            comision: comercial.comision,
            reintegro,
            recibido_vendedor,
            recibido_plataforma,
            devuelto_comprador,
            resultado,
        }
        .publish(env);
    }
}

/// Escritura persistente con extensión del TTL de la entrada y de la instancia.
fn guardar<V: IntoVal<Env, Val>>(env: &Env, clave: &Clave, valor: &V) {
    let persistente = env.storage().persistent();
    persistente.set(clave, valor);
    persistente.extend_ttl(clave, UMBRAL_TTL, EXTENSION_TTL);
    env.storage()
        .instance()
        .extend_ttl(UMBRAL_TTL, EXTENSION_TTL);
}

fn leer_laboratorio(env: &Env, lab: &Address) -> Option<Laboratorio> {
    env.storage()
        .persistent()
        .get(&Clave::Laboratorio(lab.clone()))
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
    env.storage()
        .persistent()
        .get(&Clave::Venta(lote_id.clone()))
}

fn leer_contra_analisis(env: &Env, lote_id: &String) -> Option<ContraAnalisis> {
    env.storage()
        .persistent()
        .get(&Clave::ContraAnalisis(lote_id.clone()))
}

fn borrar(env: &Env, clave: &Clave) {
    env.storage().persistent().remove(clave);
    env.storage()
        .instance()
        .extend_ttl(UMBRAL_TTL, EXTENSION_TTL);
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
    let comercial = leer_comercial(env, lote_id).unwrap();
    let reintegro = comercial.reintegro;
    transferir(
        env,
        &env.current_contract_address(),
        &venta.vendedor,
        venta.precio + reintegro,
    );
    let ingreso_plataforma = comercial.comision - reintegro;
    if ingreso_plataforma > 0 {
        transferir(
            env,
            &env.current_contract_address(),
            &comercial.destinatario_plataforma,
            ingreso_plataforma,
        );
    }
    if reintegro > 0 {
        guardar(env, &Clave::ReintegroPagado(lote_id.clone()), &true);
    }
    guardar_liquidacion(env, lote_id, venta, &comercial, comprador, true);
    lote.dueno = comprador.clone();
    lote.estado = EstadoLote::Vendido;
    guardar_lote(env, lote_id, &lote);
    borrar(env, &Clave::Venta(lote_id.clone()));
}

fn reembolsar_venta(
    env: &Env,
    lote_id: &String,
    mut lote: Lote,
    venta: &Venta,
    comprador: &Address,
) {
    let comercial = leer_comercial(env, lote_id).unwrap();
    transferir(
        env,
        &env.current_contract_address(),
        comprador,
        comercial.total,
    );
    guardar_liquidacion(env, lote_id, venta, &comercial, comprador, false);
    // Una discrepancia de pureza mantiene bloqueado el lote hasta una nueva certificación.
    lote.estado = if leer_contra_analisis(env, lote_id)
        .is_some_and(|c| c.diferencia_bps > config(env).tolerancia_bps)
    {
        EstadoLote::EnDisputa
    } else {
        EstadoLote::Certificado
    };
    guardar_lote(env, lote_id, &lote);
    borrar(env, &Clave::Venta(lote_id.clone()));
    Reembolsado {
        lote_id: lote_id.clone(),
        comprador: comprador.clone(),
        precio: venta.precio,
    }
    .publish(env);
}

fn preparar_venta(
    env: &Env,
    vendedor: &Address,
    lote_id: &String,
    precio: i128,
) -> Result<(Lote, Venta, VentaComercial), Error> {
    let mut lote = leer_lote(env, lote_id)?;
    if lote.dueno != *vendedor {
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
    if !lab_activo(env, &lote.lab) {
        return Err(Error::AnalisisNoValido);
    }
    let venta = Venta {
        vendedor: vendedor.clone(),
        precio,
        comprador: None,
        analisis_id: lote.analisis_id.clone(),
        version: lote.version,
        lab: lote.lab.clone(),
        pureza_bps: lote.pureza_bps,
        vence_garantia: None,
    };
    let comercial = condiciones_comerciales(env, lote_id, &venta)?;
    lote.estado = EstadoLote::EnVenta;
    Ok((lote, venta, comercial))
}

fn publicar_venta(
    env: &Env,
    lote_id: &String,
    lote: &Lote,
    venta: &Venta,
    comercial: &VentaComercial,
) {
    guardar(env, &Clave::Venta(lote_id.clone()), venta);
    guardar(env, &Clave::VentaComercial(lote_id.clone()), comercial);
    borrar(env, &Clave::ContraAnalisis(lote_id.clone()));
    guardar_lote(env, lote_id, lote);
    let mut publicadas = lotes_en_venta(env);
    publicadas.push_back(lote_id.clone());
    guardar(env, &Clave::LotesEnVenta, &publicadas);
    LotePublicado {
        lote_id: lote_id.clone(),
        vendedor: venta.vendedor.clone(),
        precio: venta.precio,
        pureza_bps: venta.pureza_bps,
    }
    .publish(env);
}

fn acreditar_recepcion(
    env: &Env,
    lote_id: &String,
    acreditador: &Address,
    evidencia_hash: &BytesN<32>,
) -> Result<(), Error> {
    if !evidencia_valida(evidencia_hash) {
        return Err(Error::EvidenciaInvalida);
    }
    let lote = leer_lote(env, lote_id)?;
    if lote.estado != EstadoLote::EnGarantia && lote.estado != EstadoLote::EnDisputa {
        return Err(Error::LoteNoDisponible);
    }
    let mut venta = leer_venta(env, lote_id).ok_or(Error::SinVenta)?;
    if venta.comprador.is_none() {
        return Err(Error::LoteNoDisponible);
    }
    let mut comercial = leer_comercial(env, lote_id)?;
    if comercial.recepcion.is_some() {
        return Err(Error::RecepcionExistente);
    }
    let fecha = env.ledger().timestamp();
    let vence = fecha
        .checked_add(comercial.plazo_garantia_seg)
        .ok_or(Error::PlazoInvalido)?;
    comercial.recepcion = Some(como_mapa(
        env,
        Recepcion {
            fecha,
            evidencia_hash: evidencia_hash.clone(),
            acreditador: acreditador.clone(),
        },
    ));
    venta.vence_garantia = Some(vence);
    guardar(env, &Clave::VentaComercial(lote_id.clone()), &comercial);
    guardar(env, &Clave::Venta(lote_id.clone()), &venta);
    RecepcionRegistrada {
        lote_id: lote_id.clone(),
        acreditador: acreditador.clone(),
        evidencia_hash: evidencia_hash.clone(),
        vence_garantia: vence,
    }
    .publish(env);
    Ok(())
}

#[contract]
pub struct MinerTrace;

#[contractimpl]
impl MinerTrace {
    /// Se ejecuta una sola vez, en la misma transacción del despliegue.
    pub fn __constructor(
        env: Env,
        admin: Address,
        token: Address,
        tolerancia_bps: u32,
        plazo_garantia_seg: u64,
    ) {
        if tolerancia_bps > PUREZA_MAX_BPS {
            panic_with_error!(&env, Error::ToleranciaInvalida);
        }
        if plazo_garantia_seg == 0 {
            panic_with_error!(&env, Error::PlazoInvalido);
        }
        env.storage().instance().set(
            &Clave::Config,
            &Config {
                admin: admin.clone(),
                token: token.clone(),
                tolerancia_bps,
                plazo_garantia_seg,
            },
        );
        env.storage()
            .instance()
            .extend_ttl(UMBRAL_TTL, EXTENSION_TTL);
        Configurado {
            admin,
            token,
            tolerancia_bps,
            plazo_garantia_seg,
        }
        .publish(&env);
    }

    pub fn get_config(env: Env) -> Config {
        config(&env)
    }

    /// Conserva el constructor original. La comisión del comprador es 1 %, el incentivo máximo 0,25 %.
    pub fn configurar_comercio(
        env: Env,
        destinatario_plataforma: Address,
        comision_minima: i128,
        reintegro_maximo: i128,
        plazo_entrega_seg: u64,
    ) -> Result<(), Error> {
        config(&env).admin.require_auth();
        if comision_minima < 0
            || reintegro_maximo < 0
            || plazo_entrega_seg == 0
            || destinatario_plataforma == env.current_contract_address()
        {
            return Err(Error::ConfiguracionComercialInvalida);
        }
        let configuracion = ConfigComercial {
            version: 2,
            destinatario_plataforma,
            comision_bps: 100,
            comision_minima,
            reintegro_bps: 25,
            reintegro_maximo,
            plazo_entrega_seg,
        };
        guardar(&env, &Clave::Comercio, &configuracion);
        ComercioConfigurado { configuracion }.publish(&env);
        Ok(())
    }

    pub fn get_comercio(env: Env) -> Option<ConfigComercial> {
        comercio(&env)
    }

    /// Conserva el cierre de una reserva aunque después se publique otra venta del mismo lote.
    pub fn get_orden_cancelada(env: Env, orden_id: String) -> bool {
        env.storage()
            .persistent()
            .get(&Clave::OrdenCancelada(orden_id))
            .unwrap_or(false)
    }

    /// Se conserva la última cotización incluso después del cierre; cada cierre tiene además su copia histórica.
    pub fn get_venta_comercial(env: Env, lote_id: String) -> Result<VentaComercial, Error> {
        leer_comercial(&env, &lote_id)
    }

    pub fn get_gasto_ensayo(env: Env, lote_id: String) -> Option<GastoEnsayo> {
        env.storage().persistent().get(&Clave::GastoEnsayo(lote_id))
    }

    pub fn get_liquidacion(env: Env, lote_id: String) -> Result<Liquidacion, Error> {
        historial_liquidaciones(&env, &lote_id)
            .last()
            .ok_or(Error::SinLiquidacion)
    }

    pub fn get_historial_liquidaciones(env: Env, lote_id: String) -> Vec<Liquidacion> {
        historial_liquidaciones(&env, &lote_id)
    }

    /// El coste acreditado no mueve dinero: solo permite un incentivo con cargo a una venta futura completada.
    pub fn registrar_gasto_ensayo(
        env: Env,
        lab: Address,
        lote_id: String,
        costo: i128,
        comprobante_hash: BytesN<32>,
    ) -> Result<(), Error> {
        lab.require_auth();
        if !lab_activo(&env, &lab) {
            return Err(Error::LaboratorioNoAutorizado);
        }
        let lote = leer_lote(&env, &lote_id)?;
        if lote.lab != lab {
            return Err(Error::LaboratorioDistinto);
        }
        if leer_venta(&env, &lote_id).is_some() {
            return Err(Error::LoteNoDisponible);
        }
        if costo <= 0 {
            return Err(Error::PrecioInvalido);
        }
        if !evidencia_valida(&comprobante_hash) {
            return Err(Error::EvidenciaInvalida);
        }
        if env
            .storage()
            .persistent()
            .has(&Clave::GastoEnsayo(lote_id.clone()))
        {
            return Err(Error::GastoEnsayoExistente);
        }
        if env
            .storage()
            .persistent()
            .has(&Clave::ComprobanteUsado(comprobante_hash.clone()))
        {
            return Err(Error::ComprobanteReutilizado);
        }
        guardar(
            &env,
            &Clave::GastoEnsayo(lote_id.clone()),
            &GastoEnsayo {
                lab: lab.clone(),
                costo,
                comprobante_hash: comprobante_hash.clone(),
            },
        );
        guardar(
            &env,
            &Clave::ComprobanteUsado(comprobante_hash.clone()),
            &true,
        );
        GastoEnsayoRegistrado {
            lote_id,
            lab,
            costo,
            comprobante_hash,
        }
        .publish(&env);
        Ok(())
    }

    // ---- Laboratorios ----

    pub fn add_lab(env: Env, lab: Address, nombre: String) {
        config(&env).admin.require_auth();
        guardar(
            &env,
            &Clave::Laboratorio(lab.clone()),
            &Laboratorio {
                nombre: nombre.clone(),
                activo: true,
            },
        );
        LaboratorioAgregado { lab, nombre }.publish(&env);
    }

    pub fn revoke_lab(env: Env, lab: Address) -> Result<(), Error> {
        config(&env).admin.require_auth();
        let mut laboratorio = leer_laboratorio(&env, &lab).ok_or(Error::LaboratorioInexistente)?;
        laboratorio.activo = false;
        guardar(&env, &Clave::Laboratorio(lab.clone()), &laboratorio);
        LaboratorioRevocado {
            lab,
            nombre: laboratorio.nombre,
        }
        .publish(&env);
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
                let reembolsado =
                    lote.estado == EstadoLote::EnDisputa && leer_venta(&env, &lote_id).is_none();
                let es_certificador =
                    leer_contra_analisis(&env, &lote_id).is_some_and(|c| c.lab_certificador == lab);
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
        AnalisisRegistrado {
            lote_id,
            analisis_id,
            version,
            lab,
            hash,
            pureza_bps,
        }
        .publish(&env);
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

    pub fn list_batch(
        env: Env,
        dueno: Address,
        lote_id: String,
        precio: i128,
    ) -> Result<(), Error> {
        dueno.require_auth();
        let (lote, venta, comercial) = preparar_venta(&env, &dueno, &lote_id, precio)?;
        publicar_venta(&env, &lote_id, &lote, &venta, &comercial);
        Ok(())
    }

    /// El vendedor autoriza las condiciones exactas negociadas y reserva el lote a un comprador.
    pub fn reservar_venta(
        env: Env,
        vendedor: Address,
        lote_id: String,
        comprador: Address,
        precio: i128,
        orden_id: String,
        vence_publicacion: u64,
        condiciones_hash: BytesN<32>,
    ) -> Result<(), Error> {
        vendedor.require_auth();
        if vendedor == comprador {
            return Err(Error::CompradorEsVendedor);
        }
        if orden_id.is_empty() || orden_id.len() > 100 {
            return Err(Error::OrdenInvalida);
        }
        if vence_publicacion <= env.ledger().timestamp() {
            return Err(Error::PublicacionVencida);
        }
        if !evidencia_valida(&condiciones_hash) {
            return Err(Error::EvidenciaInvalida);
        }
        if env
            .storage()
            .persistent()
            .has(&Clave::OrdenUsada(orden_id.clone()))
        {
            return Err(Error::OrdenReutilizada);
        }
        let (lote, venta, mut comercial) = preparar_venta(&env, &vendedor, &lote_id, precio)?;
        comercial.orden_id = Some(orden_id.clone());
        comercial.comprador_reservado = Some(comprador.clone());
        comercial.vence_publicacion = Some(vence_publicacion);
        comercial.condiciones_hash = Some(condiciones_hash.clone());
        publicar_venta(&env, &lote_id, &lote, &venta, &comercial);
        guardar(&env, &Clave::OrdenUsada(orden_id.clone()), &true);
        VentaReservada {
            lote_id,
            orden_id,
            vendedor,
            comprador,
            precio,
            comision: comercial.comision,
            reintegro: comercial.reintegro,
            total: comercial.total,
            vence_publicacion,
            condiciones_hash,
        }
        .publish(&env);
        Ok(())
    }

    pub fn cancelar_venta(env: Env, vendedor: Address, lote_id: String) -> Result<(), Error> {
        vendedor.require_auth();
        let mut lote = leer_lote(&env, &lote_id)?;
        let venta = leer_venta(&env, &lote_id).ok_or(Error::SinVenta)?;
        if venta.vendedor != vendedor {
            return Err(Error::NoEsVendedor);
        }
        if lote.estado != EstadoLote::EnVenta || venta.comprador.is_some() {
            return Err(Error::LoteNoDisponible);
        }
        if let Some(orden_id) = leer_comercial(&env, &lote_id)?.orden_id {
            guardar(&env, &Clave::OrdenCancelada(orden_id), &true);
        }
        lote.estado = EstadoLote::Certificado;
        guardar_lote(&env, &lote_id, &lote);
        borrar(&env, &Clave::Venta(lote_id.clone()));
        quitar_de_venta(&env, &lote_id);
        VentaCancelada { lote_id, vendedor }.publish(&env);
        Ok(())
    }

    /// El precio pasa del comprador al contrato, que lo retiene en garantía.
    /// Compatibilidad con clientes anteriores; los clientes nuevos usan financiar_orden.
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
        if !lab_activo(&env, &venta.lab) {
            return Err(Error::AnalisisNoValido);
        }
        let mut comercial = leer_comercial(&env, &lote_id)?;
        if comercial
            .vence_publicacion
            .is_some_and(|vence| env.ledger().timestamp() >= vence)
        {
            return Err(Error::PublicacionVencida);
        }
        if comercial
            .comprador_reservado
            .as_ref()
            .is_some_and(|reservado| *reservado != comprador)
        {
            return Err(Error::CompradorNoReservado);
        }
        comercial.vence_entrega = Some(
            env.ledger()
                .timestamp()
                .checked_add(comercial.plazo_entrega_seg)
                .ok_or(Error::PlazoInvalido)?,
        );

        transferir(
            &env,
            &comprador,
            &env.current_contract_address(),
            comercial.total,
        );

        venta.comprador = Some(comprador.clone());
        venta.vence_garantia = None;
        guardar(&env, &Clave::Venta(lote_id.clone()), &venta);
        guardar(&env, &Clave::VentaComercial(lote_id.clone()), &comercial);
        lote.estado = EstadoLote::EnGarantia;
        guardar_lote(&env, &lote_id, &lote);
        quitar_de_venta(&env, &lote_id);

        LoteComprado {
            lote_id,
            comprador,
            precio: venta.precio,
        }
        .publish(&env);
        Ok(())
    }

    /// La autorización firma la orden, el total y el análisis concretos, además del lote.
    /// Impide financiar otra publicación tras cancelar, renegociar o cambiar la certificación.
    pub fn financiar_orden(
        env: Env,
        comprador: Address,
        lote_id: String,
        orden_id: String,
        total_esperado: i128,
        analisis_id_esperado: String,
        version_esperada: u32,
    ) -> Result<(), Error> {
        let venta = leer_venta(&env, &lote_id).ok_or(Error::SinVenta)?;
        let comercial = leer_comercial(&env, &lote_id)?;
        let orden_coincide = match comercial.orden_id {
            Some(id) => id == orden_id,
            None => orden_id.is_empty(),
        };
        if !orden_coincide
            || comercial.total != total_esperado
            || venta.analisis_id != analisis_id_esperado
            || venta.version != version_esperada
        {
            return Err(Error::CotizacionDesactualizada);
        }
        // Llamada Rust en el mismo marco: buy exige la autorización de financiar_orden
        // (sus seis argumentos) y de la transferencia del total, sin exigirla dos veces.
        Self::buy(env, comprador, lote_id)
    }

    pub fn registrar_recepcion(
        env: Env,
        comprador: Address,
        lote_id: String,
        evidencia_hash: BytesN<32>,
    ) -> Result<(), Error> {
        comprador.require_auth();
        let venta = leer_venta(&env, &lote_id).ok_or(Error::SinVenta)?;
        if venta.comprador.as_ref() != Some(&comprador) {
            return Err(Error::NoEsComprador);
        }
        acreditar_recepcion(&env, &lote_id, &comprador, &evidencia_hash)
    }

    /// Un tercero acreditado impide que el comprador bloquee el cobro omitiendo confirmar una entrega real.
    pub fn atestiguar_entrega(
        env: Env,
        lab: Address,
        lote_id: String,
        evidencia_hash: BytesN<32>,
    ) -> Result<(), Error> {
        lab.require_auth();
        if !lab_activo(&env, &lab) {
            return Err(Error::LaboratorioNoAutorizado);
        }
        let venta = leer_venta(&env, &lote_id).ok_or(Error::SinVenta)?;
        if venta.lab != lab {
            return Err(Error::LaboratorioDistinto);
        }
        acreditar_recepcion(&env, &lote_id, &lab, &evidencia_hash)
    }

    /// Las incidencias físicas bloquean cualquier liquidación hasta el arbitraje del administrador.
    pub fn abrir_incidencia(
        env: Env,
        comprador: Address,
        lote_id: String,
        motivo: String,
    ) -> Result<(), Error> {
        comprador.require_auth();
        let mut lote = leer_lote(&env, &lote_id)?;
        if lote.estado != EstadoLote::EnGarantia && lote.estado != EstadoLote::EnDisputa {
            return Err(Error::LoteNoDisponible);
        }
        let venta = leer_venta(&env, &lote_id).ok_or(Error::SinVenta)?;
        if venta.comprador.as_ref() != Some(&comprador) {
            return Err(Error::NoEsComprador);
        }
        if venta
            .vence_garantia
            .is_some_and(|vence| env.ledger().timestamp() >= vence)
        {
            return Err(Error::GarantiaVencida);
        }
        if motivo.is_empty() || motivo.len() > 500 {
            return Err(Error::MotivoInvalido);
        }
        let mut comercial = leer_comercial(&env, &lote_id)?;
        if comercial.incidencia.is_some() {
            return Err(Error::IncidenciaExistente);
        }
        comercial.incidencia = Some(como_mapa(
            &env,
            Incidencia {
                motivo: motivo.clone(),
                fecha: env.ledger().timestamp(),
            },
        ));
        guardar(&env, &Clave::VentaComercial(lote_id.clone()), &comercial);
        lote.estado = EstadoLote::EnDisputa;
        guardar_lote(&env, &lote_id, &lote);
        IncidenciaAbierta {
            lote_id,
            comprador,
            motivo,
        }
        .publish(&env);
        Ok(())
    }

    /// Salida sin entrega: no aplica si ya hay recepción, contra-análisis o incidencia física.
    pub fn cancelar_compra(env: Env, comprador: Address, lote_id: String) -> Result<(), Error> {
        comprador.require_auth();
        let (lote, venta) = venta_en_garantia(&env, &lote_id)?;
        if venta.comprador.as_ref() != Some(&comprador) {
            return Err(Error::NoEsComprador);
        }
        let comercial = leer_comercial(&env, &lote_id)?;
        if comercial.recepcion.is_some()
            || comercial.incidencia.is_some()
            || leer_contra_analisis(&env, &lote_id).is_some()
        {
            return Err(Error::LoteNoDisponible);
        }
        let vence = comercial.vence_entrega.ok_or(Error::LoteNoDisponible)?;
        if env.ledger().timestamp() < vence {
            return Err(Error::PlazoEntregaNoVencido);
        }
        reembolsar_venta(&env, &lote_id, lote, &venta, &comprador);
        Ok(())
    }

    /// El laboratorio certificador acredita la restitución física antes del reembolso por pureza.
    pub fn registrar_devolucion(
        env: Env,
        lab: Address,
        lote_id: String,
        evidencia_hash: BytesN<32>,
    ) -> Result<(), Error> {
        lab.require_auth();
        if !lab_activo(&env, &lab) {
            return Err(Error::LaboratorioNoAutorizado);
        }
        let lote = leer_lote(&env, &lote_id)?;
        if lote.estado != EstadoLote::EnDisputa {
            return Err(Error::LoteNoDisponible);
        }
        let venta = leer_venta(&env, &lote_id).ok_or(Error::SinVenta)?;
        if venta.lab != lab {
            return Err(Error::LaboratorioDistinto);
        }
        if !evidencia_valida(&evidencia_hash) {
            return Err(Error::EvidenciaInvalida);
        }
        let mut comercial = leer_comercial(&env, &lote_id)?;
        if comercial.devolucion_hash.is_some() {
            return Err(Error::RecepcionExistente);
        }
        comercial.devolucion_hash = Some(evidencia_hash.clone());
        guardar(&env, &Clave::VentaComercial(lote_id.clone()), &comercial);
        DevolucionRegistrada {
            lote_id,
            lab,
            evidencia_hash,
        }
        .publish(&env);
        Ok(())
    }

    /// Arbitraje explícito y autenticado. Con metal entregado exige prueba de devolución para reembolsar.
    pub fn resolver_incidencia(
        env: Env,
        admin: Address,
        lote_id: String,
        reembolsar: bool,
        devolucion_hash: BytesN<32>,
    ) -> Result<(), Error> {
        if config(&env).admin != admin {
            return Err(Error::NoEsAdministrador);
        }
        admin.require_auth();
        let lote = leer_lote(&env, &lote_id)?;
        if lote.estado != EstadoLote::EnDisputa {
            return Err(Error::LoteNoDisponible);
        }
        let venta = leer_venta(&env, &lote_id).ok_or(Error::SinVenta)?;
        let comprador = venta.comprador.clone().ok_or(Error::LoteNoDisponible)?;
        let mut comercial = leer_comercial(&env, &lote_id)?;
        if reembolsar {
            if evidencia_valida(&devolucion_hash) {
                comercial.devolucion_hash = Some(devolucion_hash);
            }
            if (comercial.recepcion.is_some() || leer_contra_analisis(&env, &lote_id).is_some())
                && comercial.devolucion_hash.is_none()
            {
                return Err(Error::DevolucionNoAcreditada);
            }
            guardar(&env, &Clave::VentaComercial(lote_id.clone()), &comercial);
            // El nombre del argumento coincide con la acción; la función auxiliar tiene prefijo.
            reembolsar_venta(&env, &lote_id, lote, &venta, &comprador);
        } else {
            if comercial.recepcion.is_none() {
                return Err(Error::SinRecepcion);
            }
            if comercial.devolucion_hash.is_some() {
                return Err(Error::LoteNoDisponible);
            }
            liquidar(&env, &lote_id, lote, &venta, &comprador);
            VentaConfirmada {
                lote_id,
                vendedor: venta.vendedor,
                comprador,
                precio: venta.precio,
            }
            .publish(&env);
        }
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
        if venta
            .vence_garantia
            .is_some_and(|vence| env.ledger().timestamp() >= vence)
        {
            return Err(Error::GarantiaVencida);
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

        ContraAnalisisRegistrado {
            lote_id,
            lab,
            hash,
            pureza_bps,
            diferencia_bps,
            en_disputa,
        }
        .publish(&env);
        Ok(())
    }

    /// El comprador confirma: el vendedor cobra y el lote cambia de dueño.
    pub fn confirm(env: Env, comprador: Address, lote_id: String) -> Result<(), Error> {
        comprador.require_auth();
        let (lote, venta) = venta_en_garantia(&env, &lote_id)?;
        if venta.comprador.as_ref() != Some(&comprador) {
            return Err(Error::NoEsComprador);
        }
        // La propia confirmación firmada es un reconocimiento de recepción y renuncia al plazo restante.
        let mut comercial = leer_comercial(&env, &lote_id)?;
        if comercial.recepcion.is_none() {
            let evidencia = env.crypto().sha256(
                &(comprador.clone(), lote_id.clone(), env.ledger().timestamp()).to_xdr(&env),
            );
            comercial.recepcion = Some(como_mapa(
                &env,
                Recepcion {
                    fecha: env.ledger().timestamp(),
                    evidencia_hash: evidencia.into(),
                    acreditador: comprador.clone(),
                },
            ));
            guardar(&env, &Clave::VentaComercial(lote_id.clone()), &comercial);
        }
        liquidar(&env, &lote_id, lote, &venta, &comprador);
        VentaConfirmada {
            lote_id,
            vendedor: venta.vendedor,
            comprador,
            precio: venta.precio,
        }
        .publish(&env);
        Ok(())
    }

    /// Vencida la inspección desde una recepción acreditada, sin confirmación ni disputa, el vendedor
    /// cobra y el lote pasa al comprador, igual que si hubiera confirmado.
    pub fn claim(env: Env, vendedor: Address, lote_id: String) -> Result<(), Error> {
        vendedor.require_auth();
        let (lote, venta) = venta_en_garantia(&env, &lote_id)?;
        if venta.vendedor != vendedor {
            return Err(Error::NoEsVendedor);
        }
        if leer_comercial(&env, &lote_id)?.recepcion.is_none() {
            return Err(Error::SinRecepcion);
        }
        let vence = venta.vence_garantia.ok_or(Error::SinRecepcion)?;
        if env.ledger().timestamp() < vence {
            return Err(Error::PlazoNoVencido);
        }
        let comprador = venta.comprador.clone().ok_or(Error::LoteNoDisponible)?;
        liquidar(&env, &lote_id, lote, &venta, &comprador);
        PagoReclamado {
            lote_id,
            vendedor,
            comprador,
            precio: venta.precio,
        }
        .publish(&env);
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
        let comercial = leer_comercial(&env, &lote_id)?;
        // Una incidencia física necesita arbitraje; una discrepancia de pureza, devolución acreditada.
        if comercial.incidencia.is_some() {
            return Err(Error::LoteEnDisputa);
        }
        if comercial.devolucion_hash.is_none() {
            return Err(Error::DevolucionNoAcreditada);
        }
        reembolsar_venta(&env, &lote_id, lote, &venta, &comprador);
        Ok(())
    }
}

mod test;
