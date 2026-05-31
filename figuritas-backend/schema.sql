-- Habilitar extensión UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tipos ENUM
CREATE TYPE user_role AS ENUM ('user', 'admin');
CREATE TYPE album_status AS ENUM ('active', 'inactive');
CREATE TYPE rareza_level AS ENUM ('bronce', 'plata', 'oro', 'legendaria');
CREATE TYPE market_status AS ENUM ('open', 'accepted', 'cancelled', 'expired');
CREATE TYPE offer_type AS ENUM ('offers', 'wants');
CREATE TYPE contraoferta_status AS ENUM ('pending', 'accepted', 'rejected', 'cancelled');
CREATE TYPE activity_type AS ENUM ('pack_open', 'trade_completed', 'coins_granted', 'album_completed', 'registration', 'offer_created', 'counteroffer_created');

-- Tabla usuarios
CREATE TABLE usuarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0),
    role user_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TIMESTAMPTZ
);

-- Tabla albumes
CREATE TABLE albumes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    cover_url TEXT,
    pack_url TEXT,
    status album_status NOT NULL DEFAULT 'active',
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- Tabla secciones
CREATE TABLE secciones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    album_id UUID NOT NULL REFERENCES albumes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabla figuritas
CREATE TABLE figuritas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    album_id UUID NOT NULL REFERENCES albumes(id) ON DELETE RESTRICT,
    seccion_id UUID REFERENCES secciones(id) ON DELETE SET NULL,
    global_number INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    rareza rareza_level NOT NULL,
    is_brillante BOOLEAN NOT NULL DEFAULT false,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE(album_id, global_number)
);

-- Tabla inventario_items
CREATE TABLE inventario_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    figurita_id UUID NOT NULL REFERENCES figuritas(id) ON DELETE RESTRICT,
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    first_acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version INTEGER NOT NULL DEFAULT 1,
    UNIQUE(usuario_id, figurita_id)
);

-- Tabla probabilidades_rareza
CREATE TABLE probabilidades_rareza (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    album_id UUID REFERENCES albumes(id) ON DELETE CASCADE,
    rareza rareza_level NOT NULL,
    porcentaje INTEGER NOT NULL CHECK (porcentaje >= 0 AND porcentaje <= 100),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(album_id, rareza)
);

-- Tabla publicaciones_mercado
CREATE TABLE publicaciones_mercado (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status market_status NOT NULL DEFAULT 'open',
    expires_at TIMESTAMPTZ,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TIMESTAMPTZ
);

-- Tabla items_publicacion
CREATE TABLE items_publicacion (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    publicacion_id UUID NOT NULL REFERENCES publicaciones_mercado(id) ON DELETE CASCADE,
    tipo offer_type NOT NULL,
    figurita_id UUID REFERENCES figuritas(id) ON DELETE RESTRICT,
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    monedas INTEGER CHECK (monedas >= 0),
    CHECK (
        (figurita_id IS NOT NULL AND monedas IS NULL) OR
        (figurita_id IS NULL AND monedas IS NOT NULL)
    )
);

-- Tabla contraofertas
CREATE TABLE contraofertas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    publicacion_original_id UUID NOT NULL REFERENCES publicaciones_mercado(id) ON DELETE CASCADE,
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    mensaje TEXT,
    status contraoferta_status NOT NULL DEFAULT 'pending',
    version INTEGER NOT NULL DEFAULT 1
);

-- Tabla items_contraoferta
CREATE TABLE items_contraoferta (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    contraoferta_id UUID NOT NULL REFERENCES contraofertas(id) ON DELETE CASCADE,
    tipo offer_type NOT NULL,
    figurita_id UUID REFERENCES figuritas(id) ON DELETE RESTRICT,
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    monedas INTEGER CHECK (monedas >= 0),
    CHECK (
        (figurita_id IS NOT NULL AND monedas IS NULL) OR
        (figurita_id IS NULL AND monedas IS NOT NULL)
    )
);

-- Tabla intercambios
CREATE TABLE intercambios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_a_id UUID NOT NULL REFERENCES usuarios(id),
    usuario_b_id UUID NOT NULL REFERENCES usuarios(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    snapshot JSONB NOT NULL,
    CHECK (usuario_a_id != usuario_b_id)
);

-- Tabla actividad
CREATE TABLE actividad (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo activity_type NOT NULL,
    descripcion TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabla eventos
CREATE TABLE eventos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    type TEXT NOT NULL,
    config JSONB NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true
);

-- Índices
CREATE INDEX idx_usuarios_coins ON usuarios(coins) WHERE deleted_at IS NULL;
CREATE INDEX idx_albumes_status_display ON albumes(status, display_order) WHERE deleted_at IS NULL;
CREATE INDEX idx_figuritas_album ON figuritas(album_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_figuritas_rareza ON figuritas(rareza);
CREATE INDEX idx_inventario_usuario ON inventario_items(usuario_id);
CREATE INDEX idx_publicaciones_usuario_status ON publicaciones_mercado(usuario_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_publicacion_figurita ON items_publicacion(figurita_id) WHERE figurita_id IS NOT NULL;
CREATE INDEX idx_contraofertas_original ON contraofertas(publicacion_original_id);
CREATE INDEX idx_actividad_usuario ON actividad(usuario_id);
CREATE INDEX idx_eventos_fechas ON eventos(start_date, end_date) WHERE active = true;

-- Trigger para sumar probabilidades (opcional)
CREATE OR REPLACE FUNCTION check_probabilities_sum()
RETURNS TRIGGER AS $$
DECLARE
    total INTEGER;
BEGIN
    IF NEW.album_id IS NULL THEN
        SELECT SUM(porcentaje) INTO total FROM probabilidades_rareza WHERE album_id IS NULL;
    ELSE
        SELECT SUM(porcentaje) INTO total FROM probabilidades_rareza WHERE album_id = NEW.album_id;
    END IF;
    IF total IS NOT NULL AND total != 100 THEN
        RAISE EXCEPTION 'Suma de porcentajes debe ser 100 (actual: %)', total;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trigger_prob_sum
AFTER INSERT OR UPDATE ON probabilidades_rareza
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_probabilities_sum();