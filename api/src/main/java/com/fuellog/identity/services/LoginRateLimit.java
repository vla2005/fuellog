package com.fuellog.identity.services;

import com.fuellog.identity.repositories.LoginAttemptRepository;
import com.fuellog.platform.exceptions.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.Clock;
import java.util.HexFormat;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class LoginRateLimit {
    private final LoginAttemptRepository attempts;
    private final Clock clock;
    private final TransactionTemplate reservation;

    public LoginRateLimit(LoginAttemptRepository attempts, Clock identityClock, PlatformTransactionManager manager) {
        this.attempts = attempts; this.clock = identityClock;
        reservation = new TransactionTemplate(manager);
        reservation.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        reservation.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    }

    public void attempt(String normalizedEmail, String source) {
        if (source == null || source.isBlank() || source.length() > 128)
            throw new ApiException(503, "AUTH_DEPENDENCY_UNAVAILABLE", "Serviço temporariamente indisponível.");
        boolean allowed = Boolean.TRUE.equals(reservation.execute(status ->
                attempts.reserve(hash("s:", source), hash("a:", normalizedEmail), clock.instant())));
        // Rejections commit their reservation and never extend an existing window.
        if (!allowed) throw new ApiException(429, "LOGIN_RATE_LIMITED", "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
    }

    private static String hash(String prefix, String value) {
        try {
            return prefix + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }
}
