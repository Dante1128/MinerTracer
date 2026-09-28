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

DROP TRIGGER IF EXISTS mt_anclajes_mock_solo_insercion ON anclajes_mock;
CREATE TRIGGER mt_anclajes_mock_solo_insercion BEFORE UPDATE OR DELETE ON anclajes_mock
  FOR EACH ROW EXECUTE FUNCTION mt_solo_insercion();
`;
