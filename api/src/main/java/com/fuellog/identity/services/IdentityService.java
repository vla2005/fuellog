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
import org.springframework.dao.DataIntegrityViolationException;
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

    IdentityService(UserAccountRepository users, UserSessionRepository sessions, RefreshTokenRepository tokens,
            PasswordEncoder passwords, RefreshSecrets secrets, AccessTokenService access, Clock identityClock,
            PlatformTransactionManager manager) {
        this.users = users; this.sessions = sessions; this.tokens = tokens; this.passwords = passwords;
        this.secrets = secrets; this.access = access; this.clock = identityClock;
        this.transaction = new TransactionTemplate(manager);
        dummyPassword = passwords.encode(UUID.randomUUID().toString());
    }
    public RegisteredUser register(String name, String email, String password) {
        try {
            return transaction.execute(status -> {
                UserAccount user = users.saveAndFlush(new UserAccount(name.strip(), normalize(email), passwords.encode(password), now()));
                return new RegisteredUser(user.id(), user.name(), user.email());
            });
        } catch (DataIntegrityViolationException e) {
            throw new ApiException(409, "ACCOUNT_CONFLICT", "Não foi possível cadastrar esta conta.");
        }
    }
    public TokenResponse login(String email, String password) {
        return transaction.execute(status -> {
            UserAccount user = users.findByEmail(normalize(email)).orElse(null);
            boolean matches = passwords.matches(password, user == null ? dummyPassword : user.passwordHash());
            if (!matches || user == null || user.disabledAt() != null)
                throw new ApiException(401, "INVALID_CREDENTIALS", "E-mail ou senha inválidos.");
            Instant now = now();
            UserSession session = sessions.saveAndFlush(new UserSession(user.id(), now));
            return issuePair(session, now);
        });
    }
    public TokenResponse refresh(String secret) {
        String hash = secrets.hash(secret);
        Rotation result = transaction.execute(status -> rotate(hash));
        // Replay revocation commits before returning an authentication failure.
        if (result.error != null) throw result.error;
        return result.response;
    }
    private Rotation rotate(String hash) {
        UUID sessionId = tokens.findSessionId(hash).orElseThrow(IdentityService::invalidRefresh);
        UserSession session = sessions.lockById(sessionId).orElseThrow(IdentityService::invalidRefresh);
        RefreshToken token = tokens.findByTokenHash(hash).orElseThrow(IdentityService::invalidRefresh);
        Instant now = now();
        if (token.usedAt() != null) {
            session.revoke(now, "TOKEN_REUSE");
            tokens.revokeFamily(session.id(), now);
            return new Rotation(null, new ApiException(401, "REFRESH_TOKEN_REUSED", "Sessão encerrada. Entre novamente."));
        }
        UserAccount user = users.findById(session.userId()).orElseThrow(IdentityService::invalidRefresh);
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
        return new Rotation(response(session, nextSecret, now), null);
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
    private Instant now() { return clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MICROS); }
    public static ApiException invalidRefresh() { return new ApiException(401, "REFRESH_TOKEN_INVALID", "Sessão inválida. Entre novamente."); }
    private static String normalize(String email) { return email.strip().toLowerCase(Locale.ROOT); }
    private record Rotation(TokenResponse response, ApiException error) {}
}
