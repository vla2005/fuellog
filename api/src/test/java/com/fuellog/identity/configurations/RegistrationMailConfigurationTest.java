package com.fuellog.identity.configurations;

import static org.assertj.core.api.Assertions.*;
import java.util.Properties;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.mail.autoconfigure.MailSenderAutoConfiguration;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.mail.javamail.JavaMailSenderImpl;

class RegistrationMailConfigurationTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withInitializer(new ConfigDataApplicationContextInitializer())
            .withConfiguration(AutoConfigurations.of(MailSenderAutoConfiguration.class))
            .withPropertyValues("spring.config.location=classpath:application.properties", "FUELLOG_MAIL_HOST=smtp.example.test");

    @Test void defaultSubmissionUsesRequiredStartTlsWithCertificateHostnameVerification() {
        runner.run(context -> {
            assertThat(context).hasNotFailed().hasSingleBean(JavaMailSenderImpl.class);
            var sender = context.getBean(JavaMailSenderImpl.class);
            assertThat(sender.getHost()).isEqualTo("smtp.example.test");
            assertThat(sender.getPort()).isEqualTo(587);
            var properties = sender.getSession().getProperties();
            assertThat(properties.getProperty("mail.smtp.ssl.enable")).isEqualTo("false");
            assertThat(properties.getProperty("mail.smtp.starttls.enable")).isEqualTo("true");
            assertThat(properties.getProperty("mail.smtp.starttls.required")).isEqualTo("true");
            assertSecureDefaults(properties);
        });
    }

    @Test void implicitTlsOn465UsesSslFromConnectionStartWithoutStartTls() {
        runner.withPropertyValues("FUELLOG_MAIL_PORT=465", "FUELLOG_MAIL_SSL_ENABLED=true", "FUELLOG_MAIL_STARTTLS_ENABLED=false")
                .run(context -> {
                    assertThat(context).hasNotFailed().hasSingleBean(JavaMailSenderImpl.class);
                    var sender = context.getBean(JavaMailSenderImpl.class);
                    assertThat(sender.getPort()).isEqualTo(465);
                    var properties = sender.getSession().getProperties();
                    assertThat(properties.getProperty("mail.smtp.ssl.enable")).isEqualTo("true");
                    assertThat(properties.getProperty("mail.smtp.starttls.enable")).isEqualTo("false");
                    assertThat(properties.getProperty("mail.smtp.starttls.required")).isEqualTo("false");
                    assertSecureDefaults(properties);
                });
    }

    private static void assertSecureDefaults(Properties properties) {
        assertThat(properties.getProperty("mail.smtp.auth")).isEqualTo("true");
        assertThat(properties.getProperty("mail.smtp.ssl.checkserveridentity")).isEqualTo("true");
        assertThat(properties.getProperty("mail.smtp.ssl.trust")).isNull();
        for (String timeout : new String[]{"connectiontimeout", "timeout", "writetimeout"})
            assertThat(properties.getProperty("mail.smtp." + timeout)).isEqualTo("5000");
    }
}
