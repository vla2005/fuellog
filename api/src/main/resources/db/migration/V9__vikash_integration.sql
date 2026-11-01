CREATE TABLE vikash_connections (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(24) NOT NULL CHECK (status IN ('CONNECTED','EXPIRED','REVOKED')),
    access_cipher TEXT,
    refresh_cipher TEXT,
    access_expires_at TIMESTAMPTZ,
    automatic_send BOOLEAN NOT NULL DEFAULT false,
    choices_json TEXT,
    catalog_json TEXT,
    remote_revoked BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (status <> 'REVOKED' OR (access_cipher IS NULL AND refresh_cipher IS NULL))
);
CREATE UNIQUE INDEX ix_vikash_current ON vikash_connections(user_id) WHERE status <> 'REVOKED';
CREATE INDEX ix_vikash_owner ON vikash_connections(user_id,created_at DESC);
CREATE TABLE vikash_authorizations (
    state_hash VARCHAR(64) PRIMARY KEY,
    id UUID NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES user_sessions(id) ON DELETE CASCADE,
    verifier_cipher TEXT NOT NULL,
    platform VARCHAR(8) NOT NULL CHECK (platform IN ('web','native')),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);
CREATE INDEX ix_vikash_authorizations_user ON vikash_authorizations(user_id);
ALTER TABLE fuel_entries ADD COLUMN create_vikash_hash VARCHAR(64);
CREATE TABLE vikash_sync (
    entry_id UUID PRIMARY KEY REFERENCES fuel_entries(id),
    connection_id UUID NOT NULL REFERENCES vikash_connections(id),
    source_version BIGINT NOT NULL CHECK (source_version > 0),
    send BOOLEAN NOT NULL,
    choices_json TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    remote_etag VARCHAR(256),
    remote_version BIGINT,
    operation VARCHAR(8) NOT NULL CHECK (operation IN ('PUT','DELETE')),
    status VARCHAR(24) NOT NULL CHECK (status IN ('PENDING','SENT','ERROR','ACTION_REQUIRED','CANCELLED')),
    error_code VARCHAR(64),
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_vikash_queue ON vikash_sync(next_attempt_at) WHERE status IN ('PENDING','ERROR');
