package com.fuellog.identity.configurations;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties("fuellog.security.login-rate-limit")
public record LoginRateLimitProperties(@DefaultValue("10") int accountAttempts,
        @DefaultValue("100") int sourceAttempts, @DefaultValue("300") int windowSeconds,
        @DefaultValue("50000") int maxScopes) {
    public LoginRateLimitProperties {
        if (accountAttempts < 1 || accountAttempts > 1000 || sourceAttempts < 1 || sourceAttempts > 100000
                || windowSeconds < 1 || windowSeconds > 3600 || maxScopes < 2 || maxScopes > 1000000)
            throw new IllegalArgumentException("Login limits require account 1..1000, source 1..100000, window 1..3600 seconds and scopes 2..1000000");
    }
}
