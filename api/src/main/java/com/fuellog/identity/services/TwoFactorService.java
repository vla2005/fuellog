package com.fuellog.identity.services;

import com.fuellog.identity.dtos.TwoFactorDtos;
import com.fuellog.identity.models.UserAccount;
import com.fuellog.identity.models.UserSession;
import com.fuellog.identity.repositories.*;
import com.fuellog.identity.security.*;
import com.fuellog.platform.exceptions.ApiException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TwoFactorService {
    private final UserAccountRepository users;
    private final UserSessionRepository sessions;
    private final TwoFactorRepository factors;
    private final SessionRevocationService revocation;
    private final PasswordEncoder passwords;
    private final TwoFactorRateLimit limits;
    private final Totp totp;
    private final TotpEncryption encryption;
    private final RefreshSecrets secrets;
    private final Clock clock;

    public TwoFactorService(UserAccountRepository users, UserSessionRepository sessions, TwoFactorRepository factors,
            SessionRevocationService revocation, PasswordEncoder passwords, TwoFactorRateLimit limits,
            Totp totp, TotpEncryption encryption, RefreshSecrets secrets, Clock identityClock) {
        this.users = users; this.sessions = sessions; this.factors = factors; this.revocation = revocation;
        this.passwords = passwords; this.limits = limits; this.totp = totp; this.encryption = encryption;
        this.secrets = secrets; this.clock = identityClock;
    }

    @Transactional(readOnly = true)
    public TwoFactorDtos.Status status(UUID userId) {
        boolean enabled = enabled(userId);
        return new TwoFactorDtos.Status(enabled, enabled ? factors.recoveryCount(userId) : 0);
    }

    public boolean enabled(UUID userId) { return factors.factor(userId).map(TwoFactorRepository.Factor::enabled).orElse(false); }

    @Transactional(noRollbackFor = Rejected.class)
    public TwoFactorDtos.SetupResponse setup(UUID userId, UUID sessionId, String password) {
        UserAccount user = activeUser(userId);
        activeSession(userId, sessionId);
        limits.attempt("user:" + userId + ":setup");
        checkPassword(user, password);
        if (enabled(userId)) throw new Rejected(409, "MFA_ALREADY_ENABLED", "A autenticação em duas etapas já está ativa.");
        String secret = totp.newSecret();
        Instant expiresAt = clock.instant().plusSeconds(300);
        factors.setup(userId, encryption.encrypt(userId, secret), sessionId, user.version(), expiresAt);
        String label = encode("FuelLog:" + user.email());
        String uri = "otpauth://totp/" + label + "?secret=" + secret + "&issuer=FuelLog&algorithm=SHA1&digits=6&period=30";
        return new TwoFactorDtos.SetupResponse(secret, uri, expiresAt);
    }

    @Transactional(noRollbackFor = Rejected.class)
    public TwoFactorDtos.RecoveryCodes enable(UUID userId, UUID sessionId, String code) {
        UserAccount user = activeUser(userId);
        activeSession(userId, sessionId);
        limits.attempt("user:" + userId + ":factor");
        var factor = factors.factor(userId).orElseThrow(TwoFactorService::invalidSetup);
        if (factor.enabled()) throw new Rejected(409, "MFA_ALREADY_ENABLED", "A autenticação em duas etapas já está ativa.");
        if (!sessionId.equals(factor.pendingSessionId()) || user.version() != factor.credentialVersion()
                || !clock.instant().isBefore(factor.pendingExpiresAt())) throw invalidSetup();
        long step = totp.matchingStep(encryption.decrypt(userId, factor.encryptedSecret()), code, clock.instant(), factor.lastUsedStep());
        if (step < 0) throw invalidCode();
        factors.enable(userId, step);
        factors.clearChallenges(userId);
        factors.clearRecovery(userId);
        List<String> recovery = new ArrayList<>();
        for (int index = 0; index < 10; index++) {
            String value = secrets.generate(); // 256 random bits per recovery code; persist only its SHA-256 hash.
            factors.addRecovery(userId, secrets.hash(value));
            recovery.add(value);
        }
        revocation.revokeUserSessions(userId, "MFA_ENABLED", sessionId);
        return new TwoFactorDtos.RecoveryCodes(List.copyOf(recovery));
    }

    @Transactional(noRollbackFor = Rejected.class)
    public void disable(UUID userId, UUID sessionId, String password, String code) {
        UserAccount user = activeUser(userId);
        activeSession(userId, sessionId);
        limits.attempt("user:" + userId + ":disable");
        checkPassword(user, password);
        var factor = factors.factor(userId).filter(TwoFactorRepository.Factor::enabled)
                .orElseThrow(() -> new Rejected(409, "MFA_NOT_ENABLED", "A autenticação em duas etapas não está ativa."));
        verifyCode(userId, factor, code);
        factors.disable(userId);
        revocation.revokeUserSessions(userId, "MFA_DISABLED", sessionId);
    }

    @Transactional(noRollbackFor = Rejected.class)
    public void verifyForSensitiveAction(UUID userId, String code) {
        activeUser(userId);
        var factor = factors.factor(userId).filter(TwoFactorRepository.Factor::enabled);
        if (factor.isPresent()) verifyCode(userId, factor.get(), code);
    }

    // IdentityService owns the user lock and the transaction for login and token issuance.
    public TwoFactorDtos.Challenge challenge(UserAccount user) {
        String value = secrets.generate();
        Instant expiresAt = clock.instant().plusSeconds(300);
        factors.addChallenge(secrets.hash(value), user.id(), user.version(), expiresAt);
        return new TwoFactorDtos.Challenge(true, value, expiresAt);
    }

    @Transactional(noRollbackFor = Rejected.class)
    public UUID verifyLoginChallenge(String token, String code) {
        if (token == null || !token.matches("[A-Za-z0-9_-]{43}")) throw invalidChallenge();
        String hash = secrets.hash(token);
        var initial = factors.challenge(hash).orElseThrow(TwoFactorService::invalidChallenge);
        UserAccount user = users.lockById(initial.userId()).orElseThrow(TwoFactorService::invalidChallenge);
        var challenge = factors.challenge(hash).orElseThrow(TwoFactorService::invalidChallenge);
        if (user.disabledAt() != null || challenge.credentialVersion() != user.version()
                || !clock.instant().isBefore(challenge.expiresAt())) throw invalidChallenge();
        var factor = factors.factor(user.id()).filter(TwoFactorRepository.Factor::enabled).orElseThrow(TwoFactorService::invalidChallenge);
        limits.attempt("challenge:" + hash);
        verifyCode(user.id(), factor, code);
        factors.consumeChallenge(hash);
        return user.id();
    }

    private void verifyCode(UUID userId, TwoFactorRepository.Factor factor, String code) {
        limits.attempt("user:" + userId + ":factor");
        if (code != null && code.matches("[A-Za-z0-9_-]{43}") && factors.consumeRecovery(userId, secrets.hash(code))) return;
        long step = totp.matchingStep(encryption.decrypt(userId, factor.encryptedSecret()), code, clock.instant(), factor.lastUsedStep());
        if (step < 0) throw invalidCode();
        factors.useStep(userId, step);
    }

    private UserAccount activeUser(UUID userId) {
        UserAccount user = users.lockById(userId).orElseThrow(IdentityService::invalidRefresh);
        if (user.disabledAt() != null) throw IdentityService.invalidRefresh();
        return user;
    }
    private void activeSession(UUID userId, UUID sessionId) {
        UserSession session = sessions.lockById(sessionId).orElseThrow(IdentityService::invalidRefresh);
        if (!userId.equals(session.userId()) || !session.activeAt(clock.instant())) throw IdentityService.invalidRefresh();
    }
    private void checkPassword(UserAccount user, String password) {
        if (password == null || !passwords.matches(password, user.passwordHash()))
            throw new Rejected(422, "VALIDATION_ERROR", "Confira os campos informados.", Map.of("currentPassword", "Senha atual incorreta."));
    }
    private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20"); }
    private static Rejected invalidSetup() { return new Rejected(422, "MFA_SETUP_INVALID", "Configuração expirada ou indisponível. Inicie novamente."); }
    private static Rejected invalidCode() { return new Rejected(422, "MFA_INVALID_CODE", "Código inválido ou já utilizado.", Map.of("code", "Código inválido ou já utilizado.")); }
    private static ApiException invalidChallenge() { return new ApiException(401, "MFA_CHALLENGE_INVALID", "Verificação expirada ou inválida. Entre novamente."); }

    // Only pre-mutation validation failures use this type, allowing committed attempt counters.
    public static final class Rejected extends ApiException {
        Rejected(int status, String code, String message) { super(status, code, message); }
        Rejected(int status, String code, String message, Map<String, String> fields) { super(status, code, message, fields); }
    }
}
