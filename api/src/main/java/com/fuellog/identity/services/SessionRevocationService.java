package com.fuellog.identity.services;

import com.fuellog.identity.repositories.RefreshTokenRepository;
import com.fuellog.identity.repositories.UserAccountRepository;
import com.fuellog.identity.repositories.UserSessionRepository;

import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SessionRevocationService {
    private final UserAccountRepository users;
    private final UserSessionRepository sessions;
    private final RefreshTokenRepository tokens;
    private final Clock clock;

    SessionRevocationService(UserAccountRepository users, UserSessionRepository sessions,
            RefreshTokenRepository tokens, Clock identityClock) {
        this.users = users; this.sessions = sessions; this.tokens = tokens; this.clock = identityClock;
    }

    @Transactional
    public void revokeUserSessions(UUID userId, String reason, UUID exceptSessionId) {
        users.lockById(userId).orElseThrow(IdentityService::invalidRefresh);
        var now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        sessions.lockForRevocation(userId, exceptSessionId).forEach(session -> session.revoke(now, reason));
        tokens.revokeUserFamilies(userId, exceptSessionId, now);
    }
}
