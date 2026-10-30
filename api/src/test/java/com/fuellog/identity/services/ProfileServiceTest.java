package com.fuellog.identity.services;

import com.fuellog.identity.dtos.ProfileDtos.UpdateProfile;
import com.fuellog.identity.models.*;
import com.fuellog.identity.repositories.*;
import com.fuellog.platform.exceptions.ApiException;
import jakarta.validation.Validation;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.util.ReflectionTestUtils.setField;

class ProfileServiceTest {
    final Instant now = Instant.parse("2026-10-27T12:00:00Z");
    final UserAccountRepository users = mock(UserAccountRepository.class);
    final UserSessionRepository sessions = mock(UserSessionRepository.class);
    final PasswordEncoder passwords = mock(PasswordEncoder.class);
    final TwoFactorService factors = mock(TwoFactorService.class);
    final UserAccount user = new UserAccount("Ana", "ana@example.test", "old-hash", now.minusSeconds(60));
    final UserSession session = new UserSession(user.id(), now.minusSeconds(60));
    static final jakarta.validation.ValidatorFactory validators = Validation.buildDefaultValidatorFactory();
    final ProfileService service = new ProfileService(users, sessions, passwords, factors,
            validators.getValidator(), Clock.fixed(now, ZoneOffset.UTC));

    @AfterAll static void closeValidator() { validators.close(); }
    @BeforeEach void setup() {
        when(users.lockById(user.id())).thenReturn(Optional.of(user));
        when(sessions.lockById(session.id())).thenReturn(Optional.of(session));
    }

    @Test void rechecksSessionOwnerRevocationExpiryAndDisabledAccountBeforeCredentials() {
        when(sessions.lockById(session.id())).thenReturn(Optional.of(new UserSession(UUID.randomUUID(), now)));
        assertUnauthorized();
        when(sessions.lockById(session.id())).thenReturn(Optional.of(session));
        session.revoke(now, "LOGOUT");
        assertUnauthorized();
        setField(session, "revokedAt", null);
        setField(session, "expiresAt", now);
        assertUnauthorized();
        setField(session, "expiresAt", now.plusSeconds(60));
        setField(user, "disabledAt", now);
        assertUnauthorized();
        verifyNoInteractions(passwords, factors);
        assertThat(user.email()).isEqualTo("ana@example.test");
    }

    @Test void normalizedUnchangedEmailAndNameOnlyNeedNoCredentials() {
        var result = service.update(user.id(), session.id(), new UpdateProfile(" Ana Maria ", " ANA@example.test ", null, null));
        assertThat(result.name()).isEqualTo("Ana Maria");
        assertThat(result.email()).isEqualTo("ana@example.test");
        assertThat(user.passwordHash()).isEqualTo("old-hash");
        verifyNoInteractions(passwords, factors);
    }

    @Test void rejectedFactorNeverMutatesProfileAndDtoRedactsCredentials() {
        when(passwords.matches(" current ", "old-hash")).thenReturn(true);
        var failure = new TwoFactorService.Rejected(422, "MFA_INVALID_CODE", "Invalid code");
        doThrow(failure).when(factors).verifyForSensitiveAction(user.id(), "secret-code");
        var request = new UpdateProfile("New name", "next@example.test", " current ", "secret-code");
        assertThatThrownBy(() -> service.update(user.id(), session.id(), request)).isSameAs(failure);
        assertThat(user.name()).isEqualTo("Ana");
        assertThat(user.email()).isEqualTo("ana@example.test");
        verify(users, never()).flush();
        assertThat(request.toString()).doesNotContain(" current ", "secret-code", "next@example.test");
    }

    private void assertUnauthorized() {
        assertThatThrownBy(() -> service.update(user.id(), session.id(), new UpdateProfile("New", "new@example.test", "pwd", null)))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status()).isEqualTo(401));
    }
}
