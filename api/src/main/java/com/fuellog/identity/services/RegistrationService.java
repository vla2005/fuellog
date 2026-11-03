package com.fuellog.identity.services;

import static com.fuellog.identity.dtos.IdentityDtos.*;
import com.fuellog.identity.models.UserAccount;
import com.fuellog.identity.repositories.*;
import com.fuellog.platform.exceptions.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.core.env.Environment;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.mail.*;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.*;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class RegistrationService {
    private final RegistrationRepository registrations;
    private final UserAccountRepository users;
    private final PasswordEncoder passwords;
    private final Clock clock;
    private final ObjectProvider<JavaMailSender> mail;
    private final Environment environment;
    private final TransactionTemplate transaction;
    private final SecureRandom random = new SecureRandom();

    public RegistrationService(RegistrationRepository registrations, UserAccountRepository users, PasswordEncoder passwords,
            Clock identityClock, PlatformTransactionManager manager, ObjectProvider<JavaMailSender> mail, Environment environment) {
        this.registrations = registrations; this.users = users; this.passwords = passwords;
        this.clock = identityClock; this.mail = mail; this.environment = environment;
        transaction = new TransactionTemplate(manager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        transaction.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    }

    public RegistrationCodeSent requestCode(String email, String source) {
        String normalized = normalize(email);
        if (source == null || source.isBlank() || source.length() > 128) throw unavailable();
        Instant now = now();
        boolean allowed = Boolean.TRUE.equals(transaction.execute(status -> registrations.reserve(hash("s:", source), hash("a:", normalized), now)));
        // Failed delivery and rejected resends retain their independent abuse reservation.
        if (!allowed) throw limited();
        String from = environment.getProperty("fuellog.registration.mail-from", "");
        if (environment.getProperty("spring.mail.host", "").isBlank() || from.isBlank()) throw unavailable();
        JavaMailSender sender = mail.getIfAvailable();
        if (sender == null) throw unavailable();
        String code = String.format(Locale.ROOT, "%06d", random.nextInt(1_000_000));
        UUID id = UUID.randomUUID();
        String encoded = passwords.encode(code);
        if (!Boolean.TRUE.equals(transaction.execute(status -> registrations.issue(normalized, id, encoded, now)))) throw limited();
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(from); message.setTo(normalized); message.setSubject("FuelLog: confirme seu e-mail");
        message.setText("Seu código de confirmação do FuelLog é: " + code + "\n\n"
                + "Ele expira em 10 minutos, às " + now.plusSeconds(600) + " (UTC).\n"
                + "Não compartilhe este código. Se você não solicitou o cadastro, ignore este e-mail.");
        try { sender.send(message); }
        catch (MailException error) {
            transaction.executeWithoutResult(status -> registrations.consume(id));
            throw unavailable();
        }
        return new RegistrationCodeSent(id, now.plusSeconds(600), 60);
    }

    public RegisteredUser register(String name, String email, String password, UUID verificationId, String code) {
        if (verificationId == null || code == null || !code.matches("[0-9]{6}")) throw invalid();
        String normalized = normalize(email);
        try {
            RegistrationResult result = transaction.execute(status -> {
                var pending = registrations.lock(verificationId, normalized).orElse(null);
                if (pending == null || pending.attempts() >= 5 || !now().isBefore(pending.expiresAt())) return null;
                if (!passwords.matches(code, pending.hash())) { registrations.reject(verificationId); return null; }
                if (users.findByEmail(normalized).isPresent()) {
                    registrations.consume(verificationId);
                    return new RegistrationResult(null, conflict());
                }
                UserAccount created = users.saveAndFlush(new UserAccount(name.strip(), normalized, passwords.encode(password), now()));
                registrations.consume(verificationId);
                return new RegistrationResult(new RegisteredUser(created.id(), created.name(), created.email()), null);
            });
            // Commit failed attempts and consumed valid proofs before returning a rejection.
            if (result == null) throw invalid();
            if (result.error != null) throw result.error;
            return result.user;
        } catch (DataIntegrityViolationException error) {
            throw conflict();
        }
    }

    private Instant now() { return clock.instant().truncatedTo(ChronoUnit.MICROS); }
    private static String normalize(String email) { return email.strip().toLowerCase(Locale.ROOT); }
    private static ApiException invalid() { return new ApiException(400, "REGISTRATION_CODE_INVALID", "Código inválido ou expirado. Solicite um novo código."); }
    private static ApiException limited() { return new ApiException(429, "REGISTRATION_RATE_LIMITED", "Aguarde antes de solicitar outro código e tente novamente."); }
    private static ApiException unavailable() { return new ApiException(503, "REGISTRATION_DELIVERY_UNAVAILABLE", "Não foi possível enviar o código. Tente novamente mais tarde."); }
    private static ApiException conflict() { return new ApiException(409, "ACCOUNT_CONFLICT", "Não foi possível cadastrar esta conta."); }
    private record RegistrationResult(RegisteredUser user, ApiException error) {}
    private static String hash(String prefix, String value) {
        try { return prefix + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }
}
