package com.fuellog.identity.services;

import com.fuellog.identity.models.UserAccount;
import com.fuellog.identity.models.UserSession;
import com.fuellog.identity.repositories.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class PasswordChangeSessionRevocationTest {
    @Test void locksOwnerBeforeSessionsAndRevokesRefreshFamiliesWithSameScopeAndTime() {
        var users = mock(UserAccountRepository.class);
        var sessions = mock(UserSessionRepository.class);
        var tokens = mock(RefreshTokenRepository.class);
        var now = Instant.parse("2026-10-27T12:00:00.123456789Z");
        var persistedTime = Instant.parse("2026-10-27T12:00:00.123456Z");
        var user = new UserAccount("Ana", "ana@example.test", "hash", now);
        var session = new UserSession(user.id(), now.minusSeconds(60));
        var service = new SessionRevocationService(users, sessions, tokens, Clock.fixed(now, ZoneOffset.UTC));
        when(users.lockById(user.id())).thenReturn(Optional.of(user));
        for (UUID except : Arrays.asList(null, UUID.randomUUID())) {
            when(sessions.lockForRevocation(user.id(), except)).thenReturn(List.of(session));
            service.revokeUserSessions(user.id(), "PASSWORD_CHANGED", except);
            assertThat(session.revokedAt()).isEqualTo(persistedTime);
            var order = inOrder(users, sessions, tokens);
            order.verify(users).lockById(user.id());
            order.verify(sessions).lockForRevocation(user.id(), except);
            order.verify(tokens).revokeUserFamilies(user.id(), except, persistedTime);
            clearInvocations(users, sessions, tokens);
        }
    }
}
