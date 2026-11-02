package com.fuellog.identity.repositories;

import com.fuellog.identity.configurations.LoginRateLimitProperties;
import java.sql.Timestamp;
import java.time.Instant;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class LoginAttemptRepository {
    private final JdbcTemplate jdbc;
    private final LoginRateLimitProperties limits;

    public LoginAttemptRepository(JdbcTemplate jdbc, LoginRateLimitProperties limits) {
        this.jdbc = jdbc; this.limits = limits;
    }

    public boolean reserve(String sourceScope, String accountScope, Instant now) {
        // Serialize the bounded table's capacity check across instances, never password verification.
        jdbc.execute("select pg_advisory_xact_lock(3296039427108720)");
        jdbc.update("""
                delete from login_attempts where scope in (
                    select scope from login_attempts where window_ends_at<=? order by window_ends_at limit 100)
                """, Timestamp.from(now));
        return attempt(sourceScope, limits.sourceAttempts(), now)
                && attempt(accountScope, limits.accountAttempts(), now);
    }

    private boolean attempt(String scope, int maximum, Instant now) {
        var counts = jdbc.queryForList("""
                insert into login_attempts(scope,attempts,window_ends_at)
                select ?,1,? where exists(select 1 from login_attempts where scope=?)
                    or (select count(*) from login_attempts)<?
                on conflict(scope) do update set
                    attempts=case when login_attempts.window_ends_at<=? then 1 else least(login_attempts.attempts+1,?) end,
                    window_ends_at=case when login_attempts.window_ends_at<=? then excluded.window_ends_at else login_attempts.window_ends_at end
                returning attempts
                """, Integer.class, scope, Timestamp.from(now.plusSeconds(limits.windowSeconds())), scope,
                limits.maxScopes(), Timestamp.from(now), maximum + 1, Timestamp.from(now));
        return !counts.isEmpty() && counts.getFirst() <= maximum;
    }
}
