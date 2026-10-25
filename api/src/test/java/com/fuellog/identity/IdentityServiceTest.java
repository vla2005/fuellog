package com.fuellog.identity;

import java.time.*;
import java.util.*;
import com.fuellog.platform.ApiException;
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
    IdentityService service;
    UserAccount user;
    UserSession session;
    RefreshToken token;
    String secret;
    @BeforeEach void setup() {
        when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(passwords.encode(any())).thenReturn("encoded");
        service = new IdentityService(users, sessions, tokens, passwords, secrets, access, Clock.fixed(now, ZoneOffset.UTC), transactions);
        user = new UserAccount("Ana", "ana@example.com", "hash", now);
        session = new UserSession(user.id, now.minusSeconds(60));
        secret = secrets.generate();
        token = new RefreshToken(session.id, secrets.hash(secret), now.minusSeconds(60), session.expiresAt);
        when(tokens.findSessionId(token.tokenHash)).thenReturn(Optional.of(session.id));
        when(sessions.lockById(session.id)).thenReturn(Optional.of(session));
        when(tokens.findByTokenHash(token.tokenHash)).thenReturn(Optional.of(token));
        when(users.findById(user.id)).thenReturn(Optional.of(user));
        when(tokens.saveAndFlush(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(access.issue(any(), any())).thenReturn(new AccessTokenService.IssuedAccess("jwt", now.plusSeconds(900), 900));
    }
    @Test void rotationConsumesBeforeInsertAndPreservesAbsoluteExpiry() {
        var response = service.refresh(secret);
        assertThat(token.usedAt).isEqualTo(now);
        assertThat(token.replacedById).isNotNull();
        assertThat(response.refresh_token()).isNotEqualTo(secret);
        assertThat(response.refresh_expires_at()).isEqualTo(session.expiresAt);
        var order = inOrder(tokens, transactions);
        order.verify(tokens).findSessionId(token.tokenHash);
        order.verify(tokens).findByTokenHash(token.tokenHash);
        order.verify(tokens).flush();
        order.verify(tokens).saveAndFlush(any());
        order.verify(transactions).commit(any());
    }
    @Test void replayCommitsRevocationBeforeThrowing() {
        token.usedAt = now.minusSeconds(1);
        assertThatThrownBy(() -> service.refresh(secret)).isInstanceOfSatisfying(ApiException.class,
                error -> assertThat(error.code()).isEqualTo("REFRESH_TOKEN_REUSED"));
        assertThat(session.revocationReason).isEqualTo("TOKEN_REUSE");
        verify(tokens).revokeFamily(session.id, now);
        verify(transactions).commit(any());
        verify(transactions, never()).rollback(any());
        verify(access, never()).issue(any(), any());
    }
    @Test void absoluteDeadlineIsExclusive() {
        session.expiresAt = now;
        assertThatThrownBy(() -> service.refresh(secret)).isInstanceOf(ApiException.class);
        verify(tokens, never()).saveAndFlush(any());
    }
    @Test void disabledUserCannotRefresh() {
        user.disabledAt = now;
        assertThatThrownBy(() -> service.refresh(secret)).isInstanceOf(ApiException.class);
        verify(access, never()).issue(any(), any());
    }
    @Test void revokedSessionCannotRefresh() {
        session.revoke(now, "LOGOUT");
        assertThatThrownBy(() -> service.refresh(secret)).isInstanceOf(ApiException.class);
    }
    @Test void logoutRevokesSessionAndRefreshFamily() {
        service.logout(session.id);
        assertThat(session.revocationReason).isEqualTo("LOGOUT");
        verify(tokens).revokeFamily(session.id, now);
        verify(transactions).commit(any());
    }
    @Test void refreshFailuresDistinguishRevokedExpiredAndDisabled() {
        session.revoke(now, "LOGOUT");
        assertRefreshCode("REFRESH_TOKEN_REVOKED");
        session.revokedAt = null; session.expiresAt = now;
        assertRefreshCode("REFRESH_TOKEN_EXPIRED");
        session.expiresAt = now.plusSeconds(1); user.disabledAt = now;
        assertRefreshCode("USER_DISABLED");
    }
    private void assertRefreshCode(String code) {
        assertThatThrownBy(() -> service.refresh(secret)).isInstanceOfSatisfying(ApiException.class,
                error -> assertThat(error.code()).isEqualTo(code));
    }
    @Test void persistedSessionDeadlineUsesPostgresMicrosecondPrecision() {
        UserSession created = new UserSession(UUID.randomUUID(), Instant.parse("2026-10-25T01:51:26.564165800Z"));
        assertThat(created.createdAt).isEqualTo(Instant.parse("2026-10-25T01:51:26.564165Z"));
        assertThat(created.expiresAt).isEqualTo(Instant.parse("2027-04-25T01:51:26.564165Z"));
        assertThat(created.expiresAt.getNano() % 1000).isZero();
    }
    @Test void sixCalendarMonthsUseUtcAndClampMonthEnd() {
        UserSession created = new UserSession(UUID.randomUUID(), now);
        assertThat(created.expiresAt).isEqualTo(Instant.parse("2027-02-28T12:34:56Z"));
        assertThat(created.activeAt(created.expiresAt)).isFalse();
    }
    @Test void secretsHave256BitsAndOnlyHashIsPersistent() {
        String a = secrets.generate(), b = secrets.generate();
        assertThat(Base64.getUrlDecoder().decode(a)).hasSize(32);
        assertThat(a).isNotEqualTo(b);
        assertThat(secrets.hash(a)).matches("[0-9a-f]{64}").isEqualTo(secrets.hash(a));
        assertThatThrownBy(() -> secrets.hash("jwt.or.bad")).isInstanceOf(ApiException.class);
    }
}
