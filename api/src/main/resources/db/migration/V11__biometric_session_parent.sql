ALTER TABLE user_sessions
    ADD COLUMN biometric_parent_session_id UUID REFERENCES user_sessions(id);

CREATE INDEX ix_sessions_biometric_parent ON user_sessions(biometric_parent_session_id)
    WHERE biometric_parent_session_id IS NOT NULL;
