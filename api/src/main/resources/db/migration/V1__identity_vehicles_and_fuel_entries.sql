CREATE TABLE users (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL CHECK (btrim(name) <> ''),
    email VARCHAR(254) NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
    password_hash TEXT NOT NULL,
    disabled_at TIMESTAMPTZ,
    preferred_timezone VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revocation_reason VARCHAR(40),
    device_label VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CHECK (expires_at > created_at)
);
CREATE INDEX ix_sessions_user ON user_sessions(user_id);
CREATE INDEX ix_sessions_expiry ON user_sessions(expires_at);

CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    replaced_by_id UUID REFERENCES refresh_tokens(id),
    CHECK (expires_at > issued_at)
);
CREATE INDEX ix_refresh_session ON refresh_tokens(session_id);
CREATE INDEX ix_refresh_expiry ON refresh_tokens(expires_at);
CREATE UNIQUE INDEX ux_refresh_current ON refresh_tokens(session_id)
    WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE vehicles (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname VARCHAR(60) NOT NULL CHECK (btrim(nickname) <> ''),
    brand VARCHAR(80),
    model VARCHAR(80),
    model_year SMALLINT CHECK (model_year BETWEEN 1886 AND 2200),
    plate VARCHAR(16),
    tank_capacity_liters NUMERIC(8,3) CHECK (tank_capacity_liters > 0),
    archived_at TIMESTAMPTZ,
    pending_history_gap_after TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX ix_vehicles_owner_archive ON vehicles(user_id, archived_at);

CREATE TABLE vehicle_allowed_fuels (
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    fuel_type VARCHAR(32) NOT NULL CHECK (fuel_type IN
        ('GASOLINE_REGULAR', 'GASOLINE_ADDITIVE', 'ETHANOL', 'DIESEL_S10', 'DIESEL_S500')),
    PRIMARY KEY (vehicle_id, fuel_type)
);

CREATE TABLE fuel_entries (
    id UUID PRIMARY KEY,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    occurred_at TIMESTAMPTZ NOT NULL,
    timezone VARCHAR(64) NOT NULL,
    odometer_km BIGINT NOT NULL CHECK (odometer_km >= 0),
    fuel_type VARCHAR(32) NOT NULL,
    liters NUMERIC(10,3) NOT NULL CHECK (liters > 0),
    unit_price NUMERIC(10,4) NOT NULL CHECK (unit_price > 0),
    paid_total NUMERIC(12,2) NOT NULL CHECK (paid_total > 0),
    adjustment_reason VARCHAR(300),
    tank_state VARCHAR(16) NOT NULL CHECK (tank_state IN ('FULL', 'PARTIAL', 'UNKNOWN')),
    history_gap_before BOOLEAN NOT NULL DEFAULT false,
    station_name VARCHAR(120),
    notes VARCHAR(1000),
    create_request_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    FOREIGN KEY (vehicle_id, fuel_type) REFERENCES vehicle_allowed_fuels(vehicle_id, fuel_type),
    CHECK (abs(paid_total - round(liters * unit_price, 2)) <= 0.05
        OR nullif(btrim(adjustment_reason), '') IS NOT NULL)
);
CREATE INDEX ix_entries_vehicle_chronology ON fuel_entries(vehicle_id, occurred_at, id);
