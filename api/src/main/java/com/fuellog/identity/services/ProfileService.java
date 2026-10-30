package com.fuellog.identity.services;

import com.fuellog.identity.dtos.IdentityDtos.Me;
import com.fuellog.identity.dtos.ProfileDtos.UpdateProfile;
import com.fuellog.identity.repositories.*;
import com.fuellog.platform.exceptions.ApiException;
import jakarta.validation.Validator;
import jakarta.validation.constraints.Email;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ProfileService {
    private final UserAccountRepository users;
    private final UserSessionRepository sessions;
    private final PasswordEncoder passwords;
    private final TwoFactorService twoFactor;
    private final Validator validator;
    private final Clock clock;

    ProfileService(UserAccountRepository users, UserSessionRepository sessions, PasswordEncoder passwords,
            TwoFactorService twoFactor, Validator validator, Clock identityClock) {
        this.users = users; this.sessions = sessions; this.passwords = passwords;
        this.twoFactor = twoFactor; this.validator = validator; this.clock = identityClock;
    }

    @Transactional(noRollbackFor = TwoFactorService.Rejected.class)
    public Me update(UUID userId, UUID sessionId, UpdateProfile request) {
        var user = users.lockById(userId).orElseThrow(IdentityService::invalidRefresh);
        if (user.disabledAt() != null) throw new ApiException(401, "USER_DISABLED", "Conta indisponível.");
        var session = sessions.lockById(sessionId).orElseThrow(IdentityService::invalidRefresh);
        var now = clock.instant().truncatedTo(ChronoUnit.MICROS);
        if (!userId.equals(session.userId()) || !session.activeAt(now))
            throw new ApiException(401, "SESSION_REVOKED", "Sessão encerrada. Entre novamente.");

        String name = request.name() == null ? "" : request.name().strip();
        String email = request.email() == null ? "" : request.email().strip().toLowerCase(Locale.ROOT);
        var errors = new LinkedHashMap<String, String>();
        if (name.isEmpty() || name.length() > 100) errors.put("name", "O nome deve ter entre 1 e 100 caracteres.");
        if (email.isEmpty() || email.length() > 254 || !validator.validate(new EmailValue(email)).isEmpty())
            errors.put("email", "Informe um e-mail válido com até 254 caracteres.");
        boolean emailChanged = !user.email().equals(email);
        if (emailChanged && (request.currentPassword() == null || request.currentPassword().length() > 128
                || !passwords.matches(request.currentPassword(), user.passwordHash())))
            errors.put("currentPassword", "Senha atual incorreta.");
        if (!errors.isEmpty()) throw new ApiException(422, "VALIDATION_ERROR", "Confira os campos informados.", errors);

        // Expected MFA rejections occur before profile mutation, so only attempt counters commit.
        if (emailChanged) twoFactor.verifyForSensitiveAction(userId, request.secondFactorCode());
        user.updateProfile(name, email, now);
        try { users.flush(); }
        catch (DataIntegrityViolationException error) {
            if (!(error.getCause() instanceof org.hibernate.exception.ConstraintViolationException constraint)
                    || !"users_email_key".equals(constraint.getConstraintName())) throw error;
            throw new ApiException(409, "ACCOUNT_CONFLICT", "Este e-mail já está em uso.", Map.of("email", "Este e-mail já está em uso."));
        }
        return new Me(user.id(), user.name(), user.email(), user.preferredTimezone());
    }

    private record EmailValue(@Email String email) {}
}
