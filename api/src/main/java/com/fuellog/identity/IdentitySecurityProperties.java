package com.fuellog.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.core.io.Resource;

@ConfigurationProperties("fuellog.security")
record IdentitySecurityProperties(String issuer, String audience, Resource privateKey, Resource publicKey) {
    IdentitySecurityProperties {
        issuer = issuer == null ? "fuellog-api" : issuer;
        audience = audience == null ? "fuellog-mobile" : audience;
        if (issuer.isBlank() || audience.isBlank()) throw new IllegalArgumentException("JWT issuer and audience must not be blank");
    }
}
