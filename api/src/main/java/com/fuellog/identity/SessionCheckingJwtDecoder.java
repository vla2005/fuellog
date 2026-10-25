package com.fuellog.identity;

import java.time.Clock;
import java.util.UUID;
import org.springframework.dao.DataAccessException;
import org.springframework.security.oauth2.jwt.*;

final class SessionCheckingJwtDecoder implements JwtDecoder {
    private final JwtDecoder signature;
    private final UserSessionRepository sessions;
    private final UserAccountRepository users;
    private final Clock clock;
    SessionCheckingJwtDecoder(JwtDecoder signature, UserSessionRepository sessions, UserAccountRepository users, Clock clock) {
        this.signature = signature; this.sessions = sessions; this.users = users; this.clock = clock;
    }
    @Override public Jwt decode(String value) throws JwtException {
        if (value == null || value.length() > 8192) throw new BadJwtException("Invalid access token");
        Jwt jwt = signature.decode(value);
        try {
            UUID userId = UUID.fromString(jwt.getSubject());
            UUID sessionId = UUID.fromString(jwt.getClaimAsString("sid"));
            UserSession session = sessions.findById(sessionId).orElseThrow(() -> new AccessFailure("SESSION_REVOKED"));
            if (!session.userId.equals(userId)) throw new BadJwtException("Invalid access claims");
            if (session.revokedAt != null) throw new AccessFailure("SESSION_REVOKED");
            if (!clock.instant().isBefore(session.expiresAt)) throw new AccessFailure("SESSION_EXPIRED");
            UserAccount user = users.findById(userId).orElseThrow(() -> new AccessFailure("USER_DISABLED"));
            if (user.disabledAt != null) throw new AccessFailure("USER_DISABLED");
            return jwt;
        } catch (DataAccessException | org.springframework.transaction.TransactionException | jakarta.persistence.PersistenceException e) {
            throw new SecurityDependencyException(e);
        } catch (IllegalArgumentException e) { throw new BadJwtException("Invalid access claims"); }
    }
    static final class AccessFailure extends BadJwtException {
        final String code;
        AccessFailure(String code) { super(code); this.code = code; }
    }
    static final class SecurityDependencyException extends BadJwtException {
        SecurityDependencyException(Throwable cause) { super("Authentication dependency unavailable", cause); }
    }
}
