package com.fuellog.identity.services;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import jakarta.mail.*;
import jakarta.mail.internet.MimeMessage;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mail.javamail.JavaMailSender;

class RegistrationEmailTest {
    @Test void brandedMessagePreservesCodeAndFallbackWithThreeRelatedInlinePngs() throws Exception {
        JavaMailSender sender = mock(JavaMailSender.class);
        var session = Session.getInstance(new Properties());
        when(sender.createMimeMessage()).thenReturn(new MimeMessage(session));
        RegistrationEmail.send(sender, "FuelLog <sender@example.test>", "recipient+private@example.test", "012345",
                Instant.parse("2026-11-02T12:10:00Z"));
        var captured = ArgumentCaptor.forClass(MimeMessage.class);
        verify(sender).send(captured.capture());
        var wire = new ByteArrayOutputStream();
        captured.getValue().writeTo(wire);
        var message = new MimeMessage(session, new ByteArrayInputStream(wire.toByteArray()));
        assertThat(message.getSubject()).isEqualTo("FuelLog: confirme seu e-mail");
        assertThat(message.getAllRecipients()).extracting(Object::toString).containsExactly("recipient+private@example.test");
        assertThat(message.isMimeType("multipart/related")).isTrue();
        Multipart related = (Multipart) message.getContent();
        assertThat(related.getCount()).isEqualTo(4);
        assertThat(related.getBodyPart(0).isMimeType("multipart/alternative")).isTrue();
        Multipart alternative = (Multipart) related.getBodyPart(0).getContent();
        assertThat(alternative.getCount()).isEqualTo(2);
        assertThat(alternative.getBodyPart(0).isMimeType("text/plain")).isTrue();
        assertThat(alternative.getBodyPart(1).isMimeType("text/html")).isTrue();
        String plain = (String) alternative.getBodyPart(0).getContent();
        assertThat(plain).contains("012345", "10 minutos", "2026-11-02T12:10:00Z", "Não compartilhe", "ignore este e-mail");
        String html = (String) alternative.getBodyPart(1).getContent();
        String template = new ClassPathResource("mail/registration-code.html").getContentAsString(StandardCharsets.UTF_8);
        assertThat(html).isEqualToNormalizingNewlines(template.replace("{{CODE}}", "012345"));
        assertThat(html).contains("012345", "cid:fuellog-mascot", "cid:fuellog-wordmark", "cid:fuellog-landscape")
                .doesNotContain("{{", "recipient+private@example.test", "sender@example.test");
        assertThat(html.toLowerCase(Locale.ROOT)).doesNotContain("http://", "https://", "data:", "<script");
        Set<String> ids = new HashSet<>();
        for (int index = 1; index < related.getCount(); index++) {
            BodyPart image = related.getBodyPart(index);
            assertThat(image.getDisposition()).isEqualTo(Part.INLINE);
            assertThat(image.isMimeType("image/png")).isTrue();
            String id = image.getHeader("Content-ID")[0];
            ids.add(id);
            String asset = id.substring("<fuellog-".length(), id.length() - 1);
            byte[] bytes;
            try (var input = image.getInputStream()) { bytes = input.readAllBytes(); }
            assertThat(bytes).startsWith(new byte[]{(byte) 137,80,78,71,13,10,26,10})
                    .isEqualTo(new ClassPathResource("mail/assets/" + asset + ".png").getContentAsByteArray());
        }
        assertThat(ids).containsExactlyInAnyOrder("<fuellog-mascot>", "<fuellog-wordmark>", "<fuellog-landscape>");
    }

    @Test void rejectsHtmlOrNonAsciiCodeBeforePreparingMessage() {
        JavaMailSender sender = mock(JavaMailSender.class);
        for (String code : new String[]{null, "12345", "１２３４５６", "<img src=x onerror=alert(1)>"})
            assertThatThrownBy(() -> RegistrationEmail.send(sender, "sender@example.test", "recipient@example.test", code, Instant.EPOCH))
                    .isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(sender);
    }
}
