package com.fuellog.identity.services;

import com.fuellog.identity.models.RefreshToken;
import com.fuellog.identity.models.UserAccount;
import com.fuellog.identity.models.UserSession;
import com.fuellog.identity.repositories.RefreshTokenRepository;
import com.fuellog.identity.repositories.UserAccountRepository;
import com.fuellog.identity.repositories.UserSessionRepository;
import com.fuellog.identity.security.RefreshSecrets;
import com.fuellog.platform.exceptions.ApiException;

import static com.fuellog.identity.dtos.IdentityDtos.*;

import java.time.Clock;
import java.time.Instant;
import java.util.*;
import java.util.function.BiFunction;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class IdentityService {
    private final UserAccountRepository users;
    private final UserSessionRepository sessions;
    private final RefreshTokenRepository tokens;
    private final PasswordEncoder passwords;
    private final RefreshSecrets secrets;
    private final AccessTokenService access;
    private final Clock clock;
    private final TransactionTemplate transaction;
    private final String dummyPassword;
    private final TwoFactorService twoFactor;
    private final LoginRateLimit loginRateLimit;

    IdentityService(UserAccountRepository users, UserSessionRepository sessions, RefreshTokenRepository tokens,
            PasswordEncoder passwords, RefreshSecrets secrets, AccessTokenService access, Clock identityClock,
            PlatformTransactionManager manager, TwoFactorService twoFactor, LoginRateLimit loginRateLimit) {
        this.users = users; this.sessions = sessions; this.tokens = tokens; this.passwords = passwords;
        this.secrets = secrets; this.access = access; this.clock = identityClock;
        this.transaction = new TransactionTemplate(manager);
        this.twoFactor = twoFactor;
        this.loginRateLimit = loginRateLimit;
        dummyPassword = passwords.encode(UUID.randomUUID().toString());
    }
    public LoginResult login(String email, String password, String source) {
        String normalizedEmail = normalize(email);
        loginRateLimit.attempt(normalizedEmail, source);
        return transaction.execute(status -> {
            UserAccount user = users.lockByEmail(normalizedEmail).orElse(null);
            boolean matches = passwords.matches(password, user == null ? dummyPassword : user.passwordHash());
            if (!matches || user == null || user.disabledAt() != null)
                throw new ApiException(401, "INVALID_CREDENTIALS", "E-mail ou senha inválidos.");
            if (twoFactor.enabled(user.id())) return twoFactor.challenge(user);
            return createSession(user.id());
        });
    }
    public TokenResponse verifyTwoFactor(String challengeToken, String code) {
        Rotation<TokenResponse> result = transaction.execute(status -> {
            try { return new Rotation<>(createSession(twoFactor.verifyLoginChallenge(challengeToken, code)), null); }
            catch (TwoFactorService.Rejected error) { return new Rotation<>(null, error); }
        });
        if (result.error != null) throw result.error;
        return result.response;
    }
    private TokenResponse createSession(UUID userId) {
        Instant now = now();
        UserSession session = sessions.saveAndFlush(new UserSession(userId, now));
        return issuePair(session, now);
    }
    public TokenResponse refresh(String secret) {
        String hash = secrets.hash(secret);
        Rotation<TokenResponse> result = transaction.execute(status ->
                rotate(hash, false, (session, nextSecret) -> response(session, nextSecret, now())));
        // Replay revocation commits before returning an authentication failure.
        if (result.error != null) throw result.error;
        return result.response;
    }
    public BiometricSession createBiometricSession(UUID userId, UUID currentSessionId, String currentRefreshSecret) {
        String hash = secrets.hash(currentRefreshSecret);
        return transaction.execute(status -> {
            UserAccount user = users.lockById(userId).orElseThrow(IdentityService::invalidRefresh);
            if (user.disabledAt() != null) throw new ApiException(401, "USER_DISABLED", "Conta indisponível.");
            UserSession current = sessions.lockById(currentSessionId).orElseThrow(IdentityService::invalidRefresh);
            Instant now = now();
            if (!current.userId().equals(userId) || current.biometricLogin() || !current.activeAt(now))
                throw invalidRefresh();
            RefreshToken proof = tokens.findByTokenHash(hash).orElseThrow(IdentityService::invalidRefresh);
            if (!proof.sessionId().equals(currentSessionId)) throw invalidRefresh();
            if (proof.usedAt() != null)
                throw new ApiException(409, "BIOMETRIC_SESSION_REFRESH_CONFLICT", "A sessão foi atualizada. Tente novamente.");
            if (proof.revokedAt() != null || !now.isBefore(proof.expiresAt())) throw invalidRefresh();
            UserSession biometric = sessions.saveAndFlush(UserSession.forBiometricLogin(current, now));
            String secret = secrets.generate();
            tokens.saveAndFlush(new RefreshToken(biometric.id(), secrets.hash(secret), now, biometric.expiresAt()));
            return biometricResponse(biometric, secret);
        });
    }
    public void revokeBiometricSession(UUID userId, UUID sessionId) {
        transaction.executeWithoutResult(status -> {
            UserSession session = sessions.lockById(sessionId).orElseThrow(IdentityService::biometricNotFound);
            if (!session.userId().equals(userId) || !session.biometricLogin()) throw biometricNotFound();
            Instant now = now();
            if (session.revokedAt() == null) session.revoke(now, "BIOMETRIC_DISABLED");
            tokens.revokeFamily(session.id(), now);
        });
    }
    public BiometricLoginResponse biometricLogin(String secret) {
        String hash = secrets.hash(secret);
        Rotation<BiometricLoginResponse> result = transaction.execute(status -> rotate(hash, true,
                (session, nextSecret) -> new BiometricLoginResponse(createBiometricLoginSession(session), biometricResponse(session, nextSecret))));
        // Replay revocation commits before returning an authentication failure.
        if (result.error != null) throw result.error;
        return result.response;
    }
    private TokenResponse createBiometricLoginSession(UserSession biometric) {
        Instant now = now();
        UserSession session = sessions.saveAndFlush(UserSession.fromBiometricLogin(biometric, now));
        return issuePair(session, now);
    }
    private <T> Rotation<T> rotate(String hash, boolean biometric, BiFunction<UserSession, String, T> issue) {
        UUID sessionId = tokens.findSessionId(hash).orElseThrow(IdentityService::invalidRefresh);
        // Serialize new active sessions with password/MFA changes before locking the remembered session.
        UserAccount lockedUser = biometric ? users.lockById(sessions.findUserId(sessionId)
                .orElseThrow(IdentityService::invalidRefresh)).orElseThrow(IdentityService::invalidRefresh) : null;
        UserSession session = sessions.lockById(sessionId).orElseThrow(IdentityService::invalidRefresh);
        if (session.biometricLogin() != biometric) throw invalidRefresh();
        RefreshToken token = tokens.findByTokenHash(hash).orElseThrow(IdentityService::invalidRefresh);
        Instant now = now();
        if (token.usedAt() != null) {
            if (biometric) revokeBiometricFamily(session, now);
            else {
                session.revoke(now, "TOKEN_REUSE");
                tokens.revokeFamily(session.id(), now);
            }
            return new Rotation<>(null, new ApiException(401, "REFRESH_TOKEN_REUSED", "Sessão encerrada. Entre novamente."));
        }
        UserAccount user = biometric ? lockedUser : users.findById(session.userId()).orElseThrow(IdentityService::invalidRefresh);
        if (user.disabledAt() != null) throw new ApiException(401, "USER_DISABLED", "Conta indisponível.");
        if (session.revokedAt() != null || token.revokedAt() != null)
            throw new ApiException(401, "REFRESH_TOKEN_REVOKED", "Sessão encerrada. Entre novamente.");
        if (!now.isBefore(session.expiresAt()) || !now.isBefore(token.expiresAt()))
            throw new ApiException(401, "REFRESH_TOKEN_EXPIRED", "Sessão expirada. Entre novamente.");
        token.markUsed(now);
        tokens.flush(); // Release the partial unique index before inserting the successor.
        String nextSecret = secrets.generate();
        RefreshToken next = tokens.saveAndFlush(new RefreshToken(session.id(), secrets.hash(nextSecret), now, session.expiresAt()));
        token.replaceWith(next.id());
        session.recordUse(now);
        return new Rotation<>(issue.apply(session, nextSecret), null);
    }
    private void revokeBiometricFamily(UserSession biometric, Instant now) {
        UUID rootId = biometric.biometricParentSessionId() == null ? biometric.id() : biometric.biometricParentSessionId();
        UserSession root = rootId.equals(biometric.id()) ? biometric : sessions.lockById(rootId).orElseThrow(IdentityService::invalidRefresh);
        root.revoke(now, "TOKEN_REUSE");
        tokens.revokeFamily(rootId, now);
        sessions.lockBiometricChildren(rootId).forEach(child -> {
            child.revoke(now, "TOKEN_REUSE");
            tokens.revokeFamily(child.id(), now);
        });
    }
    public void logout(UUID sessionId) {
        transaction.executeWithoutResult(status -> {
            UserSession session = sessions.lockById(sessionId).orElseThrow(IdentityService::invalidRefresh);
            session.revoke(now(), "LOGOUT");
            tokens.revokeFamily(sessionId, now());
        });
    }
    public Me me(UUID userId) {
        UserAccount user = users.findById(userId).orElseThrow(IdentityService::invalidRefresh);
        return new Me(user.id(), user.name(), user.email(), user.preferredTimezone());
    }
    private TokenResponse issuePair(UserSession session, Instant now) {
        String secret = secrets.generate();
        tokens.saveAndFlush(new RefreshToken(session.id(), secrets.hash(secret), now, session.expiresAt()));
        return response(session, secret, now);
    }
    private TokenResponse response(UserSession session, String secret, Instant now) {
        AccessTokenService.IssuedAccess jwt = access.issue(session, now);
        return new TokenResponse(jwt.value(), "Bearer", jwt.expiresIn(), jwt.expiresAt(), secret, session.expiresAt(), session.id());
    }
    private BiometricSession biometricResponse(UserSession session, String secret) {
        return new BiometricSession(secret, session.expiresAt(), session.id());
    }
    private static ApiException biometricNotFound() { return new ApiException(404, "RESOURCE_NOT_FOUND", "Recurso não encontrado."); }
    private Instant now() { return clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MICROS); }
    public static ApiException invalidRefresh() { return new ApiException(401, "REFRESH_TOKEN_INVALID", "Sessão inválida. Entre novamente."); }
    private static String normalize(String email) { return email.strip().toLowerCase(Locale.ROOT); }
    private record Rotation<T>(T response, ApiException error) {}
}
