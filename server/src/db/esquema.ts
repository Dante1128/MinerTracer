/**
 * Esquema idempotente (se ejecuta en cada arranque).
 *
 * Lotes y análisis son de SOLO INSERCIÓN: los triggers impiden borrar filas o
 * modificar los campos sellados por el hash. Una corrección crea una nueva
 * versión del análisis enlazada a la anterior mediante `hash_anterior`.
 * Lo único que puede actualizarse son los metadatos del anclaje.
 */
export const ESQUEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS laboratorios (
  id              TEXT PRIMARY KEY,
  nombre          TEXT NOT NULL,
  cuenta_publica  TEXT NOT NULL,
  acreditaciones  JSONB NOT NULL DEFAULT '[]',
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usuarios (
  id              SERIAL PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  nombre          TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  rol             TEXT NOT NULL CHECK (rol IN ('analista', 'supervisor')),
  laboratorio_id  TEXT NOT NULL REFERENCES laboratorios(id)
);

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS revision_acceso INT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS sesiones (
  hash TEXT PRIMARY KEY,
  usuario_id INT NOT NULL REFERENCES usuarios(id),
  revision_acceso INT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  vence TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sesiones_usuario_idx ON sesiones(usuario_id);
CREATE INDEX IF NOT EXISTS sesiones_vence_idx ON sesiones(vence);

CREATE TABLE IF NOT EXISTS recuperaciones (
  hash TEXT PRIMARY KEY,
  usuario_id INT NOT NULL REFERENCES usuarios(id),
  revision_acceso INT NOT NULL,
  vence TIMESTAMPTZ NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recuperaciones_usuario_idx ON recuperaciones(usuario_id);

CREATE TABLE IF NOT EXISTS correos_pendientes (
  id SERIAL PRIMARY KEY,
  destinatario TEXT NOT NULL,
  contenido_cifrado TEXT NOT NULL,
  intentos INT NOT NULL DEFAULT 0,
  reservado_hasta TIMESTAMPTZ NOT NULL DEFAULT now(),
  vence TIMESTAMPTZ NOT NULL
);
ALTER TABLE correos_pendientes ADD COLUMN IF NOT EXISTS usuario_id INT REFERENCES usuarios(id);

CREATE TABLE IF NOT EXISTS limites_acceso (
  clave TEXT PRIMARY KEY,
  cantidad INT NOT NULL,
  vence TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS limites_acceso_vence_idx ON limites_acceso(vence);

CREATE SEQUENCE IF NOT EXISTS seq_lote;
CREATE SEQUENCE IF NOT EXISTS seq_analisis;

CREATE TABLE IF NOT EXISTS lotes (
  id              TEXT PRIMARY KEY,
  laboratorio_id  TEXT NOT NULL REFERENCES laboratorios(id),
  tipo_mineral    TEXT NOT NULL,
  peso_kg         TEXT NOT NULL,
  origen          TEXT NOT NULL,
  coordenadas     TEXT,
  creado_por      INT NOT NULL REFERENCES usuarios(id),
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Cuenta Stellar del dueño del lote (Fase 2). No forma parte del registro
-- canónico: el contrato la usa al crear el lote y luego la actualiza al venderlo.
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS dueno TEXT;

CREATE TABLE IF NOT EXISTS analisis (
  id                SERIAL PRIMARY KEY,
  analisis_id       TEXT NOT NULL,
  version           INT NOT NULL,
  lote_id           TEXT NOT NULL REFERENCES lotes(id),
  laboratorio_id    TEXT NOT NULL REFERENCES laboratorios(id),
  analista_id       INT NOT NULL REFERENCES usuarios(id),
  -- Campos sellados por el hash
  fecha_analisis    TEXT NOT NULL,
  metodo            TEXT NOT NULL,
  pureza            TEXT NOT NULL,
  composicion       JSONB NOT NULL,
  observaciones     TEXT NOT NULL DEFAULT '',
  pdf_sha256        TEXT NOT NULL,
  salt              TEXT NOT NULL,
  version_esquema   TEXT NOT NULL,
  hash_anterior     TEXT,
  motivo_correccion TEXT,
  hash              TEXT NOT NULL,
  -- Informativo (no sellado)
  pdf_nombre        TEXT NOT NULL,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Metadatos de anclaje (únicos campos actualizables)
  estado_anclaje    TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado_anclaje IN ('pendiente', 'anclado')),
  tx_id             TEXT,
  fecha_anclaje     TEXT,
  intentos_anclaje  INT NOT NULL DEFAULT 0,
  proximo_intento   TIMESTAMPTZ,
  ultimo_error      TEXT,
  UNIQUE (analisis_id, version)
);
-- Con firma por wallet, el servidor solo ancla lo que él mismo debe firmar (semilla y pruebas).
ALTER TABLE analisis ADD COLUMN IF NOT EXISTS firma_servidor BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS analisis_lote_idx ON analisis (lote_id);
CREATE INDEX IF NOT EXISTS analisis_pendientes_idx ON analisis (estado_anclaje) WHERE estado_anclaje = 'pendiente';

-- Fase 1: sustituto de la red Stellar (ver src/anclaje/AnclajeMock.ts).
CREATE TABLE IF NOT EXISTS anclajes_mock (
  tx_id     TEXT PRIMARY KEY,
  hash      TEXT NOT NULL,
  cuenta    TEXT NOT NULL,
  fecha     TEXT NOT NULL,
  ledger    INT NOT NULL
);
CREATE SEQUENCE IF NOT EXISTS seq_ledger_mock START 1000000;

-- Contra-análisis de un lote en garantía (marketplace). Se inserta solo
-- después de registrarse en el contrato, así que siempre tiene tx_id.
CREATE TABLE IF NOT EXISTS contra_analisis (
  id                SERIAL PRIMARY KEY,
  lote_id           TEXT NOT NULL REFERENCES lotes(id),
  laboratorio_id    TEXT NOT NULL REFERENCES laboratorios(id),
  analista_id       INT NOT NULL REFERENCES usuarios(id),
  -- Campos sellados por el hash (integridad/canonico.ts, registro "contra_analisis")
  fecha_analisis    TEXT NOT NULL,
  metodo            TEXT NOT NULL,
  pureza            TEXT NOT NULL,
  composicion       JSONB NOT NULL,
  observaciones     TEXT NOT NULL DEFAULT '',
  pdf_sha256        TEXT NOT NULL,
  salt              TEXT NOT NULL,
  version_esquema   TEXT NOT NULL,
  hash              TEXT NOT NULL,
  -- Informativo
  pdf_nombre        TEXT NOT NULL,
  tx_id             TEXT NOT NULL,
  fecha_anclaje     TEXT NOT NULL,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contra_analisis_lote_idx ON contra_analisis (lote_id);

-- Copia de los eventos del contrato (el RPC solo los conserva unos días). Se
-- usa para la línea de tiempo; la verificación siempre lee el contrato.
CREATE TABLE IF NOT EXISTS eventos_contrato (
  contrato_id  TEXT NOT NULL,
  id           TEXT NOT NULL,
  tipo         TEXT NOT NULL,
  lote_id      TEXT,
  datos        JSONB NOT NULL,
  ledger       INT NOT NULL,
  fecha        TEXT NOT NULL,
  tx_hash      TEXT NOT NULL,
  PRIMARY KEY (contrato_id, id)
);
CREATE INDEX IF NOT EXISTS eventos_contrato_lote_idx ON eventos_contrato (contrato_id, lote_id);

-- Hasta dónde se leyeron los eventos de cada contrato.
CREATE TABLE IF NOT EXISTS indice_eventos (
  contrato_id  TEXT PRIMARY KEY,
  cursor       TEXT
);

-- Negociación P2P: los acuerdos no sustituyen el estado de pago del contrato.
CREATE TABLE IF NOT EXISTS comercio_desafios (
  id TEXT PRIMARY KEY,
  cuenta TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  vinculo_hash TEXT NOT NULL,
  vence TIMESTAMPTZ NOT NULL,
  consumido BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS comercio_sesiones (
  hash TEXT PRIMARY KEY,
  cuenta TEXT NOT NULL,
  vence TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS comercio_sesiones_vence_idx ON comercio_sesiones(vence);
CREATE TABLE IF NOT EXISTS comercio_perfiles (
  cuenta TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  organizacion TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL CHECK (tipo IN ('productor','cooperativa','comprador')),
  zona TEXT NOT NULL,
  contacto TEXT NOT NULL DEFAULT '',
  documento_ref TEXT NOT NULL DEFAULT '',
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS comercio_anuncios (
  id TEXT PRIMARY KEY,
  cliente_id TEXT NOT NULL,
  entrada_hash TEXT NOT NULL,
  cuenta TEXT NOT NULL REFERENCES comercio_perfiles(cuenta),
  tipo TEXT NOT NULL CHECK (tipo IN ('compra','venta')),
  mineral TEXT NOT NULL,
  zona TEXT NOT NULL,
  cantidad TEXT NOT NULL,
  precio TEXT NOT NULL,
  lote_id TEXT REFERENCES lotes(id),
  condiciones TEXT NOT NULL DEFAULT '',
  punto_entrega TEXT NOT NULL DEFAULT '',
  gastos_ensayo TEXT NOT NULL DEFAULT '0',
  gastos_traslado TEXT NOT NULL DEFAULT '0',
  oferta_externa_neta TEXT,
  plazo_pago TEXT NOT NULL DEFAULT '',
  token JSONB NOT NULL,
  estado TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado','aceptado')),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  vence TIMESTAMPTZ NOT NULL,
  UNIQUE(cuenta,cliente_id)
);
CREATE INDEX IF NOT EXISTS comercio_anuncios_lista_idx ON comercio_anuncios(estado,vence,creado_en);
CREATE TABLE IF NOT EXISTS comercio_ofertas (
  id TEXT PRIMARY KEY,
  cliente_id TEXT NOT NULL,
  entrada_hash TEXT NOT NULL,
  anuncio_id TEXT NOT NULL REFERENCES comercio_anuncios(id),
  cuenta TEXT NOT NULL REFERENCES comercio_perfiles(cuenta),
  precio TEXT NOT NULL,
  lote_id TEXT REFERENCES lotes(id),
  condiciones TEXT NOT NULL DEFAULT '',
  punto_entrega TEXT NOT NULL DEFAULT '',
  gastos_ensayo TEXT NOT NULL DEFAULT '0',
  gastos_traslado TEXT NOT NULL DEFAULT '0',
  plazo_pago TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aceptada','rechazada')),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  vence TIMESTAMPTZ NOT NULL,
  UNIQUE(cuenta,cliente_id)
);
CREATE INDEX IF NOT EXISTS comercio_ofertas_anuncio_idx ON comercio_ofertas(anuncio_id,creado_en);
ALTER TABLE comercio_ofertas ADD COLUMN IF NOT EXISTS proponente TEXT;
ALTER TABLE comercio_ofertas ADD COLUMN IF NOT EXISTS destinatario TEXT;
ALTER TABLE comercio_ofertas ADD COLUMN IF NOT EXISTS oferta_anterior_id TEXT REFERENCES comercio_ofertas(id);
CREATE TABLE IF NOT EXISTS comercio_operaciones (
  id TEXT PRIMARY KEY,
  anuncio_id TEXT NOT NULL UNIQUE REFERENCES comercio_anuncios(id),
  oferta_id TEXT NOT NULL UNIQUE REFERENCES comercio_ofertas(id),
  lote_id TEXT NOT NULL REFERENCES lotes(id),
  vendedor TEXT NOT NULL,
  comprador TEXT NOT NULL,
  precio TEXT NOT NULL,
  precio_unidades TEXT NOT NULL,
  comision_unidades TEXT NOT NULL,
  condiciones_hash TEXT NOT NULL,
  condiciones JSONB NOT NULL,
  token JSONB NOT NULL,
  politica JSONB NOT NULL,
  cotizacion JSONB NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  vence TIMESTAMPTZ NOT NULL,
  CHECK (vendedor <> comprador)
);
CREATE INDEX IF NOT EXISTS comercio_operaciones_cuentas_idx ON comercio_operaciones(vendedor,comprador,creado_en);
CREATE TABLE IF NOT EXISTS comercio_evidencias (
  id TEXT PRIMARY KEY,
  cliente_id TEXT NOT NULL,
  entrada_hash TEXT NOT NULL,
  operacion_id TEXT NOT NULL REFERENCES comercio_operaciones(id),
  cuenta TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('origen','entrega','devolucion','ensayo')),
  referencia TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  hash TEXT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cuenta,cliente_id)
);
CREATE INDEX IF NOT EXISTS comercio_evidencias_operacion_idx ON comercio_evidencias(operacion_id,creado_en);
ALTER TABLE comercio_evidencias DROP CONSTRAINT IF EXISTS comercio_evidencias_tipo_check;
ALTER TABLE comercio_evidencias ADD CONSTRAINT comercio_evidencias_tipo_check
  CHECK (tipo IN ('origen','entrega','devolucion','ensayo','decision'));
CREATE TABLE IF NOT EXISTS comercio_transacciones (
  id TEXT PRIMARY KEY,
  cuenta TEXT NOT NULL,
  accion TEXT NOT NULL,
  lote_id TEXT NOT NULL,
  orden_id TEXT,
  invocacion_hash TEXT NOT NULL,
  vence TIMESTAMPTZ NOT NULL,
  tx_id TEXT,
  fecha TEXT,
  enviando BOOLEAN NOT NULL DEFAULT false
);

CREATE OR REPLACE FUNCTION mt_solo_insercion() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es de solo inserción', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mt_proteger_analisis() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los análisis no se pueden borrar; registre una nueva versión';
  END IF;
  IF (NEW.analisis_id, NEW.version, NEW.lote_id, NEW.laboratorio_id, NEW.analista_id,
      NEW.fecha_analisis, NEW.metodo, NEW.pureza, NEW.composicion, NEW.observaciones,
      NEW.pdf_sha256, NEW.salt, NEW.version_esquema, NEW.hash_anterior,
      NEW.motivo_correccion, NEW.hash, NEW.pdf_nombre)
     IS DISTINCT FROM
     (OLD.analisis_id, OLD.version, OLD.lote_id, OLD.laboratorio_id, OLD.analista_id,
      OLD.fecha_analisis, OLD.metodo, OLD.pureza, OLD.composicion, OLD.observaciones,
      OLD.pdf_sha256, OLD.salt, OLD.version_esquema, OLD.hash_anterior,
      OLD.motivo_correccion, OLD.hash, OLD.pdf_nombre) THEN
    RAISE EXCEPTION 'Los datos de un análisis registrado no se pueden modificar; registre una nueva versión';
  END IF;
  IF OLD.tx_id IS NOT NULL AND NEW.tx_id IS DISTINCT FROM OLD.tx_id THEN
    RAISE EXCEPTION 'El anclaje de un análisis no se puede reemplazar';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mt_lotes_solo_insercion ON lotes;
CREATE TRIGGER mt_lotes_solo_insercion BEFORE UPDATE OR DELETE ON lotes
  FOR EACH ROW EXECUTE FUNCTION mt_solo_insercion();

DROP TRIGGER IF EXISTS mt_analisis_protegido ON analisis;
CREATE TRIGGER mt_analisis_protegido BEFORE UPDATE OR DELETE ON analisis
  FOR EACH ROW EXECUTE FUNCTION mt_proteger_analisis();

DROP TRIGGER IF EXISTS mt_contra_analisis_solo_insercion ON contra_analisis;
CREATE TRIGGER mt_contra_analisis_solo_insercion BEFORE UPDATE OR DELETE ON contra_analisis
  FOR EACH ROW EXECUTE FUNCTION mt_solo_insercion();

DROP TRIGGER IF EXISTS mt_eventos_contrato_solo_insercion ON eventos_contrato;
CREATE TRIGGER mt_eventos_contrato_solo_insercion BEFORE UPDATE OR DELETE ON eventos_contrato
  FOR EACH ROW EXECUTE FUNCTION mt_solo_insercion();

DROP TRIGGER IF EXISTS mt_anclajes_mock_solo_insercion ON anclajes_mock;
CREATE TRIGGER mt_anclajes_mock_solo_insercion BEFORE UPDATE OR DELETE ON anclajes_mock
  FOR EACH ROW EXECUTE FUNCTION mt_solo_insercion();

DROP TRIGGER IF EXISTS mt_comercio_operaciones_solo_insercion ON comercio_operaciones;
CREATE TRIGGER mt_comercio_operaciones_solo_insercion BEFORE UPDATE OR DELETE ON comercio_operaciones
  FOR EACH ROW EXECUTE FUNCTION mt_solo_insercion();

DROP TRIGGER IF EXISTS mt_comercio_evidencias_solo_insercion ON comercio_evidencias;
CREATE TRIGGER mt_comercio_evidencias_solo_insercion BEFORE UPDATE OR DELETE ON comercio_evidencias
  FOR EACH ROW EXECUTE FUNCTION mt_solo_insercion();
`;
