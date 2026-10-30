CREATE TABLE user_two_factors (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_secret TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    last_used_step BIGINT NOT NULL DEFAULT -1,
    pending_session_id UUID REFERENCES user_sessions(id) ON DELETE CASCADE,
    credential_version BIGINT NOT NULL,
    pending_expires_at TIMESTAMPTZ,
    CHECK (enabled OR (pending_session_id IS NOT NULL AND pending_expires_at IS NOT NULL))
);

CREATE TABLE two_factor_recovery_codes (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash CHAR(64) NOT NULL,
    PRIMARY KEY (user_id, code_hash)
);

CREATE TABLE two_factor_challenges (
    token_hash CHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_version BIGINT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_two_factor_challenges_user ON two_factor_challenges(user_id);
CREATE INDEX ix_two_factor_challenges_expiry ON two_factor_challenges(expires_at);

-- Scopes include opaque challenge hashes as well as per-user action identifiers.
CREATE TABLE two_factor_attempts (
    scope VARCHAR(128) PRIMARY KEY,
    attempts INTEGER NOT NULL CHECK (attempts > 0),
    window_ends_at TIMESTAMPTZ NOT NULL
);
