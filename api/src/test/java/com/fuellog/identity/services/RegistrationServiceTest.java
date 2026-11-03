package com.fuellog.identity.services;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fuellog.identity.repositories.*;
import com.fuellog.platform.exceptions.ApiException;
import java.time.*;
import java.util.UUID;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.*;
import org.springframework.transaction.support.SimpleTransactionStatus;

class RegistrationServiceTest {
    final RegistrationRepository pending = mock(RegistrationRepository.class);
    final UserAccountRepository users = mock(UserAccountRepository.class);
    final PasswordEncoder passwords = mock(PasswordEncoder.class);
    final PlatformTransactionManager manager = mock(PlatformTransactionManager.class);
    @SuppressWarnings("unchecked") final ObjectProvider<JavaMailSender> mail = mock(ObjectProvider.class);
    final MockEnvironment environment = new MockEnvironment();
    RegistrationService service;
    @BeforeEach void setup() {
        when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        when(pending.reserve(anyString(), anyString(), any())).thenReturn(true);
        service = new RegistrationService(pending, users, passwords, Clock.fixed(Instant.EPOCH, ZoneOffset.UTC), manager, mail, environment);
    }
    @Test void missingMailConfigurationFailsClosedWithoutCreatingAccountOrEncodingCode() {
        assertThatThrownBy(() -> service.requestCode("ana@example.test", "127.0.0.1"))
                .isInstanceOfSatisfying(ApiException.class, error -> {
                    assertThat(error.status()).isEqualTo(503);
                    assertThat(error.code()).isEqualTo("REGISTRATION_DELIVERY_UNAVAILABLE");
                });
        verifyNoInteractions(users, passwords, mail);
        verify(manager).commit(any());
    }
    @Test void missingConnectorPeerFailsClosedBeforeReservingOrIssuingCode() {
        assertThatThrownBy(() -> service.requestCode("ana@example.test", null)).isInstanceOf(ApiException.class);
        verifyNoInteractions(pending, users, passwords, mail);
    }
    @Test void missingOrMalformedVerificationCannotBypassCodeLookup() {
        for (String code : new String[]{null, "12345", "１２３４５６", "123 45"})
            assertThatThrownBy(() -> service.register("Ana", "ana@example.test", "password", UUID.randomUUID(), code)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.register("Ana", "ana@example.test", "password", null, "012345")).isInstanceOf(ApiException.class);
        verifyNoInteractions(pending, users, passwords);
    }
}
