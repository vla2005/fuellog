package com.fuellog.identity.services;

import com.fuellog.identity.repositories.TwoFactorRepository;
import java.time.Clock;
import org.springframework.stereotype.Service;

@Service
public class TwoFactorRateLimit {
    private final TwoFactorRepository factors;
    private final Clock clock;
    public TwoFactorRateLimit(TwoFactorRepository factors, Clock identityClock) {
        this.factors = factors; this.clock = identityClock;
    }
    public void attempt(String scope) {
        int attempts = factors.attempt(scope, clock.instant());
        // The caller commits only expected rejections; unexpected failures still roll back atomically.
        if (attempts > 5) throw new TwoFactorService.Rejected(429, "MFA_RATE_LIMITED", "Muitas tentativas. Aguarde cinco minutos e tente novamente.");
    }
}
