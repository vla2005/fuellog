package com.fuellog.identity.repositories;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class RegistrationRepository {
    private final JdbcTemplate jdbc;
    public RegistrationRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public boolean reserve(String sourceScope, String accountScope, Instant now) {
        // Bound registration storage independently from password-login budgets across all API instances.
        jdbc.execute("select pg_advisory_xact_lock(3296039427108721)");
        jdbc.update("""
                delete from registration_attempts where scope in (
                    select scope from registration_attempts where window_ends_at<=? order by window_ends_at limit 100)
                """, Timestamp.from(now));
        return attempt(sourceScope, 30, now) && attempt(accountScope, 5, now);
    }

    private boolean attempt(String scope, int maximum, Instant now) {
        var counts = jdbc.queryForList("""
                insert into registration_attempts(scope,attempts,window_ends_at)
                select ?,1,? where exists(select 1 from registration_attempts where scope=?)
                    or (select count(*) from registration_attempts)<20000
                on conflict(scope) do update set
                    attempts=case when registration_attempts.window_ends_at<=? then 1 else least(registration_attempts.attempts+1,?) end,
                    window_ends_at=case when registration_attempts.window_ends_at<=? then excluded.window_ends_at else registration_attempts.window_ends_at end
                returning attempts
                """, Integer.class, scope, Timestamp.from(now.plusSeconds(3600)), scope,
                Timestamp.from(now), maximum + 1, Timestamp.from(now));
        return !counts.isEmpty() && counts.getFirst() <= maximum;
    }

    public boolean issue(String email, UUID id, String hash, Instant now) {
        jdbc.execute("select pg_advisory_xact_lock(3296039427108722)");
        jdbc.update("""
                delete from registration_codes where email in (
                    select email from registration_codes where expires_at<=? order by expires_at limit 100)
                """, Timestamp.from(now));
        return jdbc.update("""
                insert into registration_codes(email,verification_id,code_hash,sent_at,expires_at)
                select ?,?,?,?,? where exists(select 1 from registration_codes where email=?)
                    or (select count(*) from registration_codes)<10000
                on conflict(email) do update set verification_id=excluded.verification_id, code_hash=excluded.code_hash,
                    attempts=0, sent_at=excluded.sent_at, expires_at=excluded.expires_at
                where registration_codes.sent_at<=?
                """, email, id, hash, Timestamp.from(now), Timestamp.from(now.plusSeconds(600)), email,
                Timestamp.from(now.minusSeconds(60))) == 1;
    }

    public Optional<Pending> lock(UUID id, String email) {
        return jdbc.query("select code_hash,attempts,expires_at from registration_codes where verification_id=? and email=? for update",
                (row, index) -> new Pending(row.getString(1), row.getInt(2), row.getTimestamp(3).toInstant()), id, email).stream().findFirst();
    }
    public void reject(UUID id) { jdbc.update("update registration_codes set attempts=least(attempts+1,5) where verification_id=?", id); }
    public void consume(UUID id) { jdbc.update("delete from registration_codes where verification_id=?", id); }
    public record Pending(String hash, int attempts, Instant expiresAt) {
        @Override public String toString() { return "Pending[redacted]"; }
    }
}
