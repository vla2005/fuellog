package com.fuellog;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.Pbkdf2PasswordEncoder;

/** Verified-code fixtures for integration tests unrelated to mail delivery. */
final class RegistrationTestSupport {
    private static final String CODE = "012345";
    private static final String HASH = Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8().encode(CODE);
    private RegistrationTestSupport() {}
    static Map<String, Object> verified(JdbcTemplate jdbc, Map<String, ?> body) {
        String email = ((String) body.get("email")).strip().toLowerCase(Locale.ROOT);
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into registration_codes(email,verification_id,code_hash,sent_at,expires_at) values (?,?,?,?,?)
                on conflict(email) do update set verification_id=excluded.verification_id, code_hash=excluded.code_hash,
                    attempts=0, sent_at=excluded.sent_at, expires_at=excluded.expires_at
                """, email, id, HASH, Timestamp.from(Instant.parse("2020-01-01T00:00:00Z")), Timestamp.from(Instant.parse("2035-01-01T00:00:00Z")));
        var request = new LinkedHashMap<String, Object>(body);
        request.put("verificationId", id.toString()); request.put("code", CODE);
        return request;
    }
}
