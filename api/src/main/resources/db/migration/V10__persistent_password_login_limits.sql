CREATE TABLE login_attempts (
    scope VARCHAR(66) PRIMARY KEY CHECK (scope ~ '^[as]:[0-9a-f]{64}$'),
    attempts INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 100001),
    window_ends_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_login_attempts_expiry ON login_attempts(window_ends_at);
