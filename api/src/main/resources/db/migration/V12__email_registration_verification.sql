CREATE TABLE registration_codes (
    email VARCHAR(254) PRIMARY KEY,
    verification_id UUID NOT NULL UNIQUE,
    code_hash VARCHAR(255) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
    sent_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > sent_at)
);
CREATE INDEX ix_registration_codes_expiry ON registration_codes(expires_at);

CREATE TABLE registration_attempts (
    scope VARCHAR(66) PRIMARY KEY,
    attempts INTEGER NOT NULL CHECK (attempts > 0),
    window_ends_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_registration_attempts_expiry ON registration_attempts(window_ends_at);
