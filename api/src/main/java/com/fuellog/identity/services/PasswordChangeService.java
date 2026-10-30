package com.fuellog.identity.services;

import com.fuellog.identity.repositories.UserAccountRepository;
import com.fuellog.identity.repositories.UserSessionRepository;
import com.fuellog.platform.exceptions.ApiException;

import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.UUID;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PasswordChangeService {
    private final UserAccountRepository users;
    private final UserSessionRepository sessions;
    private final PasswordEncoder passwords;
    private final TwoFactorService twoFactor;
    private final SessionRevocationService revocation;
    private final Clock clock;

    PasswordChangeService(UserAccountRepository users, UserSessionRepository sessions, PasswordEncoder passwords,
            TwoFactorService twoFactor, SessionRevocationService revocation, Clock identityClock) {
        this.users = users; this.sessions = sessions; this.passwords = passwords;
        this.twoFactor = twoFactor; this.revocation = revocation; this.clock = identityClock;
    }

    @Transactional(noRollbackFor = TwoFactorService.Rejected.class)
    public void changePassword(UUID userId, UUID sessionId, String currentPassword, String newPassword, String secondFactorCode) {
        var user = users.lockById(userId).orElseThrow(IdentityService::invalidRefresh);
        if (user.disabledAt() != null) throw new ApiException(401, "USER_DISABLED", "Conta indisponível.");
        var session = sessions.lockById(sessionId).orElseThrow(IdentityService::invalidRefresh);
        var now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        if (!session.userId().equals(userId) || !session.activeAt(now))
            throw new ApiException(401, "SESSION_REVOKED", "Sessão encerrada. Entre novamente.");

        var errors = new LinkedHashMap<String, String>();
        boolean currentMatches = currentPassword != null && currentPassword.length() <= 128
                && passwords.matches(currentPassword, user.passwordHash());
        if (!currentMatches) errors.put("currentPassword", "Senha atual incorreta.");
        if (newPassword == null || newPassword.isBlank() || newPassword.length() < 6 || newPassword.length() > 128)
            errors.put("newPassword", "A nova senha deve ter entre 6 e 128 caracteres.");
        else if (currentMatches && newPassword.equals(currentPassword))
            errors.put("newPassword", "A nova senha deve ser diferente da atual.");
        if (!errors.isEmpty()) throw new ApiException(422, "VALIDATION_ERROR", "Confira os campos informados.", errors);

        twoFactor.verifyForSensitiveAction(userId, secondFactorCode);
        user.changePassword(passwords.encode(newPassword), now);
        revocation.revokeUserSessions(userId, "PASSWORD_CHANGED", null);
    }
}
