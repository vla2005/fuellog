package com.fuellog.identity.services;

import jakarta.mail.MessagingException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mail.MailPreparationException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;

final class RegistrationEmail {
    private RegistrationEmail() {}

    static void send(JavaMailSender sender, String from, String recipient, String code, Instant expiresAt) {
        if (code == null || !code.matches("[0-9]{6}")) throw new IllegalArgumentException("Six ASCII digits required");
        try {
            var message = sender.createMimeMessage();
            var helper = new MimeMessageHelper(message, MimeMessageHelper.MULTIPART_MODE_RELATED, StandardCharsets.UTF_8.name());
            helper.setFrom(from); helper.setTo(recipient); helper.setSubject("FuelLog: confirme seu e-mail");
            String plain = "Seu código de confirmação do FuelLog é: " + code + "\n\n"
                    + "Ele expira em 10 minutos, às " + expiresAt + " (UTC).\n"
                    + "Não compartilhe este código. Se você não solicitou o cadastro, ignore este e-mail.";
            String html = new ClassPathResource("mail/registration-code.html").getContentAsString(StandardCharsets.UTF_8)
                    .replace("{{CODE}}", code);
            helper.setText(plain, html);
            // Inline parts follow the alternative body so mail clients resolve its CID references correctly.
            for (String asset : new String[]{"mascot", "wordmark", "landscape"})
                helper.addInline("fuellog-" + asset, new ClassPathResource("mail/assets/" + asset + ".png"), "image/png");
            sender.send(message);
        } catch (MessagingException | IOException error) {
            throw new MailPreparationException("Unable to prepare registration email", error);
        }
    }
}
