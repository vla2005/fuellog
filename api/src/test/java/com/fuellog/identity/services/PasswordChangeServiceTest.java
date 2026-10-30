package com.fuellog.identity.services;

import com.fuellog.identity.dtos.PasswordChangeDtos.ChangePassword;
import com.fuellog.identity.models.UserAccount;
import com.fuellog.identity.models.UserSession;
import com.fuellog.identity.repositories.UserAccountRepository;
import com.fuellog.identity.repositories.UserSessionRepository;
import com.fuellog.platform.exceptions.ApiException;

import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.util.ReflectionTestUtils.setField;

class PasswordChangeServiceTest {
    final Instant now = Instant.parse("2026-10-27T12:00:00Z");
    final UserAccountRepository users = mock(UserAccountRepository.class);
    final UserSessionRepository sessions = mock(UserSessionRepository.class);
    final PasswordEncoder passwords = mock(PasswordEncoder.class);
    final TwoFactorService factors = mock(TwoFactorService.class);
    final SessionRevocationService revocation = mock(SessionRevocationService.class);
    final UserAccount user = new UserAccount("Ana", "ana@example.test", "old-hash", now.minusSeconds(60));
    final UserSession session = new UserSession(user.id(), now.minusSeconds(60));
    final PasswordChangeService service = new PasswordChangeService(users, sessions, passwords, factors, revocation,
            Clock.fixed(now, ZoneOffset.UTC));

    @BeforeEach void setup() {
        when(users.lockById(user.id())).thenReturn(Optional.of(user));
        when(sessions.lockById(session.id())).thenReturn(Optional.of(session));
        when(passwords.matches(" current ", "old-hash")).thenReturn(true);
        when(passwords.encode(any())).thenReturn("new-hash");
    }

    @Test void locksBeforeCheckingCredentialsAndRevokesEverySessionAfterFactor() {
        service.changePassword(user.id(), session.id(), " current ", " next password ", "123456");
        var order = inOrder(users, sessions, passwords, factors, revocation);
        order.verify(users).lockById(user.id());
        order.verify(sessions).lockById(session.id());
        order.verify(passwords).matches(" current ", "old-hash");
        order.verify(factors).verifyForSensitiveAction(user.id(), "123456");
        order.verify(passwords).encode(" next password ");
        order.verify(revocation).revokeUserSessions(user.id(), "PASSWORD_CHANGED", null);
        assertThat(user.passwordHash()).isEqualTo("new-hash");
    }

    @Test void invalidPasswordsPreserveCredentialsAndNeverConsumeFactorOrRevoke() {
        for (String next : Arrays.asList(null, "", "12345", "      ", "x".repeat(129), " current ")) {
            assertValidation(" current ", next, "newPassword");
        }
        for (String current : Arrays.asList(null, "", "wrong-password", "x".repeat(129))) {
            assertValidation(current, "next-password", "currentPassword");
        }
        verifyNoInteractions(factors, revocation);
        verify(passwords, never()).encode(any());
        assertThat(user.passwordHash()).isEqualTo("old-hash");
    }

    @Test void acceptsBothLengthBoundariesWithoutTrimming() {
        for (String next : List.of(" abcd ", "x".repeat(128))) {
            user.changePassword("old-hash", now);
            service.changePassword(user.id(), session.id(), " current ", next, null);
            verify(passwords).encode(next);
        }
    }

    @Test void rejectedSecondFactorCannotChangePasswordOrRevokeSessions() {
        var failure = new ApiException(422, "VALIDATION_ERROR", "Invalid factor");
        doThrow(failure).when(factors).verifyForSensitiveAction(user.id(), "bad");
        assertThatThrownBy(() -> service.changePassword(user.id(), session.id(), " current ", "next-password", "bad"))
                .isSameAs(failure);
        assertThat(user.passwordHash()).isEqualTo("old-hash");
        verify(passwords, never()).encode(any());
        verifyNoInteractions(revocation);
    }

    @Test void rechecksSessionOwnershipRevocationExpiryAndDisabledAccount() {
        when(sessions.lockById(session.id())).thenReturn(Optional.of(new UserSession(UUID.randomUUID(), now)));
        assertAuthenticationFailure();
        when(sessions.lockById(session.id())).thenReturn(Optional.of(session));
        session.revoke(now, "LOGOUT");
        assertAuthenticationFailure();
        setField(session, "revokedAt", null);
        setField(session, "expiresAt", now);
        assertAuthenticationFailure();
        setField(session, "expiresAt", now.plusSeconds(60));
        setField(user, "disabledAt", now);
        assertAuthenticationFailure();
        verifyNoInteractions(passwords, factors, revocation);
    }

    @Test void requestStringNeverContainsCredentials() {
        assertThat(new ChangePassword("secret-current", "secret-new", "secret-factor").toString())
                .doesNotContain("secret-current", "secret-new", "secret-factor");
    }

    private void assertValidation(String current, String next, String field) {
        assertThatThrownBy(() -> service.changePassword(user.id(), session.id(), current, next, null))
                .isInstanceOfSatisfying(ApiException.class, error -> {
                    assertThat(error.status()).isEqualTo(422);
                    assertThat(error.code()).isEqualTo("VALIDATION_ERROR");
                    assertThat(error.fieldErrors()).containsKey(field);
                });
    }

    private void assertAuthenticationFailure() {
        assertThatThrownBy(() -> service.changePassword(user.id(), session.id(), " current ", "next-password", null))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(401));
    }
}
