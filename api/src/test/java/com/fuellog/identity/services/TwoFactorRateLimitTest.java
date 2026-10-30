package com.fuellog.identity.services;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fuellog.identity.repositories.TwoFactorRepository;
import java.time.*;
import org.junit.jupiter.api.Test;

class TwoFactorRateLimitTest {
    @Test void exhaustedAttemptsUseOnlyTheExpectedRejectionType() {
        var repository = mock(TwoFactorRepository.class);
        var now = Instant.parse("2026-10-27T12:00:00Z");
        when(repository.attempt("user:factor", now)).thenReturn(6);
        var limit = new TwoFactorRateLimit(repository, Clock.fixed(now, ZoneOffset.UTC));
        assertThatThrownBy(() -> limit.attempt("user:factor")).isInstanceOfSatisfying(TwoFactorService.Rejected.class,
                error -> assertThat(error.status()).isEqualTo(429));
        when(repository.attempt("user:factor", now)).thenReturn(5);
        assertThatCode(() -> limit.attempt("user:factor")).doesNotThrowAnyException();
    }
}
