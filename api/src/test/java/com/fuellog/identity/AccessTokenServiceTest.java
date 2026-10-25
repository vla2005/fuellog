package com.fuellog.identity;

import java.time.*;
import java.util.*;
import com.fuellog.platform.ApiException;
import org.junit.jupiter.api.*;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class AccessTokenServiceTest {
    final Instant now = Instant.parse("2026-10-24T22:00:00Z");
    final Clock clock = Clock.fixed(now, ZoneOffset.UTC);
    final UserSessionRepository sessions = mock(UserSessionRepository.class);
    final UserAccountRepository users = mock(UserAccountRepository.class);
    final IdentitySecurityConfiguration configuration = new IdentitySecurityConfiguration();
    final IdentitySecurityProperties properties = new IdentitySecurityProperties("test-issuer", "test-audience", null, null);
    AccessTokenService service;
    JwtDecoder decoder;
    UserSession session;
    @BeforeEach void setup() throws Exception {
        StandardEnvironment environment = new StandardEnvironment(); environment.setActiveProfiles("test");
        var key = configuration.identitySigningKey(properties, environment);
        service = new AccessTokenService(configuration.jwtEncoder(key), properties);
        decoder = configuration.jwtDecoder(key, properties, sessions, users, clock);
        UserAccount user = new UserAccount("Ana", "ana@example.com", "hash", now);
        session = new UserSession(user.id, now);
        when(sessions.findById(session.id)).thenReturn(Optional.of(session));
        when(users.findById(user.id)).thenReturn(Optional.of(user));
    }
    @Test void actualRs256JwtHasRequiredClaimsAndChecksSessionEveryTime() {
        var issued = service.issue(session, now);
        Jwt jwt = decoder.decode(issued.value()); decoder.decode(issued.value());
        assertThat(jwt.getHeaders().get("alg")).isEqualTo("RS256");
        assertThat(jwt.getSubject()).isEqualTo(session.userId.toString());
        assertThat(jwt.getClaimAsString("sid")).isEqualTo(session.id.toString());
        assertThat(jwt.getClaimAsString("token_use")).isEqualTo("access");
        assertThat(jwt.getAudience()).containsExactly("test-audience");
        assertThat(jwt.getIssuedAt()).isEqualTo(now); assertThat(jwt.getNotBefore()).isEqualTo(now);
        assertThat(jwt.getId()).isNotBlank(); assertThat(issued.expiresIn()).isEqualTo(900);
        verify(sessions, times(2)).findById(session.id);
    }
    @Test void accessExpiryNeverExceedsSessionDeadline() {
        session.expiresAt = now.plusSeconds(10);
        var issued = service.issue(session, now);
        assertThat(issued.expiresAt()).isEqualTo(session.expiresAt);
        assertThat(issued.expiresIn()).isEqualTo(10);
    }
    @Test void revokedSessionImmediatelyRejectsUnexpiredJwt() {
        String value = service.issue(session, now).value(); session.revoke(now, "LOGOUT");
        assertThatThrownBy(() -> decoder.decode(value)).isInstanceOf(JwtException.class);
    }
    @Test void databaseFailureIs503AndHasNoBearerChallenge() throws Exception {
        when(sessions.findById(session.id)).thenThrow(new DataAccessResourceFailureException("private db details"));
        var provider = new org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationProvider(decoder);
        Throwable error = catchThrowable(() -> provider.authenticate(new org.springframework.security.oauth2.server.resource.authentication.BearerTokenAuthenticationToken(service.issue(session, now).value())));
        MockHttpServletResponse response = new MockHttpServletResponse(); SecurityProblems.authentication(response, error);
        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(response.getContentAsString()).contains("AUTH_DEPENDENCY_UNAVAILABLE").doesNotContain("private db details");
        assertThat(response.getHeader("WWW-Authenticate")).isNull();
    }
    @Test void otherUsersSessionCannotAuthenticate() {
        String value = service.issue(session, now).value(); session.userId = UUID.randomUUID();
        assertThatThrownBy(() -> decoder.decode(value)).isInstanceOf(JwtException.class);
    }
    @Test void invalidIssuerAndAudienceAndPurposeAreRejected() throws Exception {
        StandardEnvironment environment = new StandardEnvironment(); environment.setActiveProfiles("test");
        var key = configuration.identitySigningKey(properties, environment);
        JwtDecoder checked = configuration.jwtDecoder(key, properties, sessions, users, clock);
        for (String invalid : List.of("issuer", "audience", "purpose")) {
            var claims = JwtClaimsSet.builder().issuer(invalid.equals("issuer") ? "wrong" : properties.issuer())
                    .audience(List.of(invalid.equals("audience") ? "wrong" : properties.audience()))
                    .subject(session.userId.toString()).claim("sid", session.id.toString()).id(UUID.randomUUID().toString())
                    .issuedAt(now).notBefore(now).expiresAt(now.plusSeconds(900))
                    .claim("token_use", invalid.equals("purpose") ? "refresh" : "access").build();
            String value = configuration.jwtEncoder(key).encode(JwtEncoderParameters.from(
                    JwsHeader.with(org.springframework.security.oauth2.jose.jws.SignatureAlgorithm.RS256).build(), claims)).getTokenValue();
            assertThatThrownBy(() -> checked.decode(value)).isInstanceOf(JwtException.class);
        }
        verifyNoInteractions(sessions);
    }
    @Test void expiredAccessHasStableCode() throws Exception {
        String value = service.issue(session, now.minusSeconds(1000)).value();
        Throwable error = catchThrowable(() -> decoder.decode(value));
        MockHttpServletResponse response = new MockHttpServletResponse(); SecurityProblems.authentication(response, error);
        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentAsString()).contains("ACCESS_TOKEN_EXPIRED");
        assertThat(response.getHeader("WWW-Authenticate")).contains("Bearer");
    }
    @Test void connectionFailureBeforeQueryIsAlso503ThroughBearerFilter() throws Exception {
        when(sessions.findById(session.id)).thenThrow(new org.springframework.transaction.CannotCreateTransactionException("secret connection string"));
        var provider = new org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationProvider(decoder);
        var filter = new org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter(
                new org.springframework.security.authentication.ProviderManager(provider));
        filter.setAuthenticationEntryPoint((request, response, error) -> SecurityProblems.authentication(response, error));
        var request = new org.springframework.mock.web.MockHttpServletRequest("GET", "/api/v1/me");
        request.addHeader("Authorization", "Bearer " + service.issue(session, now).value());
        var response = new MockHttpServletResponse();
        var chain = new org.springframework.mock.web.MockFilterChain();
        filter.doFilter(request, response, chain);
        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(response.getContentAsString()).contains("AUTH_DEPENDENCY_UNAVAILABLE").doesNotContain("secret connection string");
        assertThat(chain.getRequest()).isNull();
    }
    @Test void tamperedSignatureCannotQuerySession() {
        String value = service.issue(session, now).value();
        String[] parts = value.split("\\.");
        byte[] signature = Base64.getUrlDecoder().decode(parts[2]); signature[0] ^= 1;
        String changed = parts[0] + "." + parts[1] + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(signature);
        assertThatThrownBy(() -> decoder.decode(changed)).isInstanceOf(JwtException.class);
        verifyNoInteractions(sessions);
    }
    @Test void sessionAndUserFailuresHaveNonRenewableCodes() throws Exception {
        String value = service.issue(session, now).value();
        session.revoke(now, "LOGOUT");
        assertCode(value, "SESSION_REVOKED");
        session.revokedAt = null; session.expiresAt = now;
        assertCode(value, "SESSION_EXPIRED");
        session.expiresAt = now.plusSeconds(100);
        UserAccount disabled = new UserAccount("Ana", "ana@example.com", "hash", now); disabled.disabledAt = now;
        when(users.findById(session.userId)).thenReturn(Optional.of(disabled));
        assertCode(value, "USER_DISABLED");
        MockHttpServletResponse response = new MockHttpServletResponse();
        SecurityProblems.authentication(response, new org.springframework.security.authentication.InsufficientAuthenticationException("missing"));
        assertThat(response.getContentAsString()).contains("ACCESS_TOKEN_MISSING");
    }
    private void assertCode(String value, String code) throws Exception {
        Throwable error = catchThrowable(() -> decoder.decode(value));
        MockHttpServletResponse response = new MockHttpServletResponse(); SecurityProblems.authentication(response, error);
        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentAsString()).contains(code);
    }
    @Test void responseExpiryMatchesNumericDatePrecisionAndNeverRoundsDeadlineUp() {
        session.expiresAt = now.plusSeconds(10).plusNanos(500_000_000);
        var issued = service.issue(session, now.plusNanos(123_000_000));
        assertThat(issued.expiresAt()).isEqualTo(decoder.decode(issued.value()).getExpiresAt());
        assertThat(issued.expiresAt()).isBeforeOrEqualTo(session.expiresAt);
        assertThat(issued.expiresIn()).isEqualTo(10);
        session.expiresAt = now.plusNanos(500_000_000);
        assertThatThrownBy(() -> service.issue(session, now)).isInstanceOf(ApiException.class);
    }
    @Test void defaultProfileCannotStartWithoutExternalKeys() {
        assertThatThrownBy(() -> configuration.identitySigningKey(properties, new StandardEnvironment()))
                .isInstanceOf(IllegalStateException.class);
    }
    @Test void credentialAllowlistIsExactAndMethodBound() {
        for (String path : List.of("register", "login", "refresh")) {
            assertThat(IdentitySecurityConfiguration.publicCredentials("POST", "/api/v1/auth/" + path)).isTrue();
            assertThat(IdentitySecurityConfiguration.publicCredentials("GET", "/api/v1/auth/" + path)).isFalse();
        }
        assertThat(IdentitySecurityConfiguration.publicCredentials("POST", "/api/v1/auth/logout")).isFalse();
        assertThat(IdentitySecurityConfiguration.publicCredentials("POST", "/api/v1/auth/refresh/extra")).isFalse();
        assertThat(IdentitySecurityConfiguration.publicCredentials("POST", "/api/v1/new-route")).isFalse();
    }
    @Test void absentContextCannotSupplyCurrentUser() {
        SecurityContextHolder.clearContext();
        assertThatThrownBy(() -> new CurrentUserService().requireUserId()).isInstanceOf(ApiException.class);
    }
}
