package com.fuellog.identity.services;

import com.fuellog.identity.models.RefreshToken;
import com.fuellog.identity.models.UserAccount;
import com.fuellog.identity.models.UserSession;
import com.fuellog.identity.repositories.RefreshTokenRepository;
import com.fuellog.identity.repositories.UserAccountRepository;
import com.fuellog.identity.repositories.UserSessionRepository;
import com.fuellog.identity.security.RefreshSecrets;
import com.fuellog.platform.exceptions.ApiException;

import static org.springframework.test.util.ReflectionTestUtils.*;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.*;
import org.springframework.transaction.support.SimpleTransactionStatus;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class IdentityServiceTest {
    final Instant now = Instant.parse("2026-08-31T12:34:56Z");
    final UserAccountRepository users = mock(UserAccountRepository.class);
    final UserSessionRepository sessions = mock(UserSessionRepository.class);
    final RefreshTokenRepository tokens = mock(RefreshTokenRepository.class);
    final PasswordEncoder passwords = mock(PasswordEncoder.class);
    final PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
    final AccessTokenService access = mock(AccessTokenService.class);
    final RefreshSecrets secrets = new RefreshSecrets();
    final TwoFactorService twoFactor = mock(TwoFactorService.class);
    IdentityService service;
    UserAccount user;
    UserSession session;
    RefreshToken token;
    String secret;
    @BeforeEach void setup() {
        when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(passwords.encode(any())).thenReturn("encoded");
        service = new IdentityService(users, sessions, tokens, passwords, secrets, access, Clock.fixed(now, ZoneOffset.UTC), transactions, twoFactor);
        user = new UserAccount("Ana", "ana@example.com", "hash", now);
        session = new UserSession(user.id(), now.minusSeconds(60));
        secret = secrets.generate();
        token = new RefreshToken(session.id(), secrets.hash(secret), now.minusSeconds(60), session.expiresAt());
        when(tokens.findSessionId(((String) getField(token,"tokenHash")))).thenReturn(Optional.of(session.id()));
        when(sessions.lockById(session.id())).thenReturn(Optional.of(session));
        when(tokens.findByTokenHash(((String) getField(token,"tokenHash")))).thenReturn(Optional.of(token));
        when(users.findById(user.id())).thenReturn(Optional.of(user));
        when(tokens.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(access.issue(any(), any())).thenReturn(new AccessTokenService.IssuedAccess("jwt", now.plusSeconds(900), 900));
    }
    @Test void rotationConsumesBeforeInsertAndPreservesAbsoluteExpiry() {
        var response = service.refresh(secret);
        assertThat(token.usedAt()).isEqualTo(now);
        assertThat(((UUID) getField(token,"replacedById"))).isNotNull();
        assertThat(response.refresh_token()).isNotEqualTo(secret);
        assertThat(response.refresh_expires_at()).isEqualTo(session.expiresAt());
        var order = inOrder(tokens, transactions);
        order.verify(tokens).findSessionId(((String) getField(token,"tokenHash")));
        order.verify(tokens).findByTokenHash(((String) getField(token,"tokenHash")));
        order.verify(tokens).flush();
        order.verify(tokens).saveAndFlush(any());
        order.verify(transactions).commit(any());
    }
    @Test void loginWithoutFactorPreservesTokenResponseAndLocksUserBeforeCreatingSession() {
        when(users.lockByEmail(user.email())).thenReturn(Optional.of(user));
        when(passwords.matches("password", "hash")).thenReturn(true);
        when(sessions.saveAndFlush(any())).thenAnswer(call -> call.getArgument(0));
        assertThat(service.login(user.email(), "password")).isInstanceOf(com.fuellog.identity.dtos.IdentityDtos.TokenResponse.class);
        var order = inOrder(users, sessions);
        order.verify(users).lockByEmail(user.email());
        order.verify(sessions).saveAndFlush(any());
    }
    @Test void enabledFactorReturnsChallengeWithoutCreatingAnySessionOrTokens() {
        when(users.lockByEmail(user.email())).thenReturn(Optional.of(user));
        when(passwords.matches("password", "hash")).thenReturn(true);
        when(twoFactor.enabled(user.id())).thenReturn(true);
        var challenge = new com.fuellog.identity.dtos.TwoFactorDtos.Challenge(true, secrets.generate(), now.plusSeconds(300));
        when(twoFactor.challenge(user)).thenReturn(challenge);
        assertThat(service.login(user.email(), "password")).isSameAs(challenge);
        verify(sessions, never()).saveAndFlush(any());
        verify(tokens, never()).saveAndFlush(any());
        verify(access, never()).issue(any(), any());
    }
    @Test void incorrectPasswordNeverCreatesSecondFactorChallenge() {
        when(users.lockByEmail(user.email())).thenReturn(Optional.of(user));
        assertThatThrownBy(() -> service.login(user.email(), "wrong")).isInstanceOf(ApiException.class);
        verifyNoInteractions(twoFactor);
        verify(access, never()).issue(any(), any());
    }
    @Test void replayCommitsRevocationBeforeThrowing() {
        setField(token,"usedAt",now.minusSeconds(1));
        assertThatThrownBy(() -> service.refresh(secret)).isInstanceOfSatisfying(ApiException.class,
                error -> assertThat(error.code()).isEqualTo("REFRESH_TOKEN_REUSED"));
        assertThat(((String) getField(session,"revocationReason"))).isEqualTo("TOKEN_REUSE");
        verify(tokens).revokeFamily(session.id(), now);
        verify(transactions).commit(any());
        verify(transactions, never()).rollback(any());
        verify(access, never()).issue(any(), any());
    }
    @Test void absoluteDeadlineIsExclusive() {
        setField(session,"expiresAt",now);
        assertThatThrownBy(() -> service.refresh(secret)).isInstanceOf(ApiException.class);
        verify(tokens, never()).saveAndFlush(any());
    }
    @Test void disabledUserCannotRefresh() {
        setField(user,"disabledAt",now);
        assertThatThrownBy(() -> service.refresh(secret)).isInstanceOf(ApiException.class);
        verify(access, never()).issue(any(), any());
    }
    @Test void revokedSessionCannotRefresh() {
        session.revoke(now, "LOGOUT");
        assertThatThrownBy(() -> service.refresh(secret)).isInstanceOf(ApiException.class);
    }
    @Test void logoutRevokesSessionAndRefreshFamily() {
        service.logout(session.id());
        assertThat(((String) getField(session,"revocationReason"))).isEqualTo("LOGOUT");
        verify(tokens).revokeFamily(session.id(), now);
        verify(transactions).commit(any());
    }
    @Test void refreshFailuresDistinguishRevokedExpiredAndDisabled() {
        session.revoke(now, "LOGOUT");
        assertRefreshCode("REFRESH_TOKEN_REVOKED");
        setField(session,"revokedAt",null); setField(session,"expiresAt",now);
        assertRefreshCode("REFRESH_TOKEN_EXPIRED");
        setField(session,"expiresAt",now.plusSeconds(1)); setField(user,"disabledAt",now);
        assertRefreshCode("USER_DISABLED");
    }
    private void assertRefreshCode(String code) {
        assertThatThrownBy(() -> service.refresh(secret)).isInstanceOfSatisfying(ApiException.class,
                error -> assertThat(error.code()).isEqualTo(code));
    }
    @Test void persistedSessionDeadlineUsesPostgresMicrosecondPrecision() {
        UserSession created = new UserSession(UUID.randomUUID(), Instant.parse("2026-10-25T01:51:26.564165800Z"));
        assertThat(((Instant) getField(created,"createdAt"))).isEqualTo(Instant.parse("2026-10-25T01:51:26.564165Z"));
        assertThat(created.expiresAt()).isEqualTo(Instant.parse("2027-04-25T01:51:26.564165Z"));
        assertThat(created.expiresAt().getNano() % 1000).isZero();
    }
    @Test void sixCalendarMonthsUseUtcAndClampMonthEnd() {
        UserSession created = new UserSession(UUID.randomUUID(), now);
        assertThat(created.expiresAt()).isEqualTo(Instant.parse("2027-02-28T12:34:56Z"));
        assertThat(created.activeAt(created.expiresAt())).isFalse();
    }
    @Test void secretsHave256BitsAndOnlyHashIsPersistent() {
        String a = secrets.generate(), b = secrets.generate();
        assertThat(Base64.getUrlDecoder().decode(a)).hasSize(32);
        assertThat(a).isNotEqualTo(b);
        assertThat(secrets.hash(a)).matches("[0-9a-f]{64}").isEqualTo(secrets.hash(a));
        assertThatThrownBy(() -> secrets.hash("jwt.or.bad")).isInstanceOf(ApiException.class);
    }
}
