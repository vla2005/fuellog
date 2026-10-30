package com.fuellog.identity.repositories;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class TwoFactorRepository {
    private final JdbcTemplate jdbc;
    public TwoFactorRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public record Factor(String encryptedSecret, boolean enabled, long lastUsedStep, UUID pendingSessionId,
            long credentialVersion, Instant pendingExpiresAt) {
        @Override public String toString() { return "Factor[redacted]"; }
    }
    public record Challenge(UUID userId, long credentialVersion, Instant expiresAt) {}

    // All factor/challenge writes are serialized by the owning user's pessimistic lock.
    public Optional<Factor> factor(UUID userId) {
        return jdbc.query("select * from user_two_factors where user_id=?", (rs, row) -> {
            Timestamp expiry = rs.getTimestamp("pending_expires_at");
            return new Factor(rs.getString("encrypted_secret"), rs.getBoolean("enabled"), rs.getLong("last_used_step"),
                    rs.getObject("pending_session_id", UUID.class), rs.getLong("credential_version"), expiry == null ? null : expiry.toInstant());
        }, userId).stream().findFirst();
    }
    public void setup(UUID userId, String encrypted, UUID sessionId, long version, Instant expiry) {
        jdbc.update("""
                insert into user_two_factors(user_id,encrypted_secret,pending_session_id,credential_version,pending_expires_at)
                values (?,?,?,?,?) on conflict(user_id) do update set encrypted_secret=excluded.encrypted_secret,
                pending_session_id=excluded.pending_session_id,credential_version=excluded.credential_version,
                pending_expires_at=excluded.pending_expires_at,last_used_step=-1
                """, userId, encrypted, sessionId, version, Timestamp.from(expiry));
    }
    public void enable(UUID userId, long step) {
        jdbc.update("update user_two_factors set enabled=true,last_used_step=?,pending_session_id=null,pending_expires_at=null where user_id=?", step, userId);
    }
    public void useStep(UUID userId, long step) { jdbc.update("update user_two_factors set last_used_step=? where user_id=?", step, userId); }
    public int recoveryCount(UUID userId) { return jdbc.queryForObject("select count(*) from two_factor_recovery_codes where user_id=?", Integer.class, userId); }
    public void addRecovery(UUID userId, String hash) { jdbc.update("insert into two_factor_recovery_codes(user_id,code_hash) values (?,?)", userId, hash); }
    public boolean consumeRecovery(UUID userId, String hash) { return jdbc.update("delete from two_factor_recovery_codes where user_id=? and code_hash=?", userId, hash) == 1; }
    public void clearChallenges(UUID userId) { jdbc.update("delete from two_factor_challenges where user_id=?", userId); }
    public void clearRecovery(UUID userId) { jdbc.update("delete from two_factor_recovery_codes where user_id=?", userId); }
    public void disable(UUID userId) {
        clearChallenges(userId); clearRecovery(userId);
        jdbc.update("delete from user_two_factors where user_id=?", userId);
    }
    public void addChallenge(String hash, UUID userId, long version, Instant expiry) {
        jdbc.update("delete from two_factor_challenges where user_id=? and expires_at<=?", userId, Timestamp.from(expiry.minusSeconds(300)));
        jdbc.update("insert into two_factor_challenges(token_hash,user_id,credential_version,expires_at) values (?,?,?,?)", hash, userId, version, Timestamp.from(expiry));
    }
    public Optional<Challenge> challenge(String hash) {
        return jdbc.query("select * from two_factor_challenges where token_hash=?", (rs, row) ->
                new Challenge(rs.getObject("user_id", UUID.class), rs.getLong("credential_version"), rs.getTimestamp("expires_at").toInstant()), hash).stream().findFirst();
    }
    public void consumeChallenge(String hash) { jdbc.update("delete from two_factor_challenges where token_hash=?", hash); }

    public int attempt(String scope, Instant now) {
        return jdbc.queryForObject("""
                insert into two_factor_attempts(scope,attempts,window_ends_at) values (?,1,?)
                on conflict(scope) do update set
                attempts=case when two_factor_attempts.window_ends_at<=? then 1 else least(two_factor_attempts.attempts+1,6) end,
                window_ends_at=case when two_factor_attempts.window_ends_at<=? then excluded.window_ends_at else two_factor_attempts.window_ends_at end
                returning attempts
                """, Integer.class, scope, Timestamp.from(now.plusSeconds(300)), Timestamp.from(now), Timestamp.from(now));
    }
}
