package com.fuellog.identity;

import java.time.*;
import java.util.*;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.stereotype.Service;

@Service
public class AccessTokenService {
    private final JwtEncoder encoder;
    private final IdentitySecurityProperties properties;
    AccessTokenService(JwtEncoder encoder, IdentitySecurityProperties properties) {
        this.encoder = encoder; this.properties = properties;
    }
    IssuedAccess issue(UserSession session, Instant now) {
        now = now.truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        Instant deadline = session.expiresAt.truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        Instant expires = now.plusSeconds(900).isBefore(deadline) ? now.plusSeconds(900) : deadline;
        if (!expires.isAfter(now)) throw new com.fuellog.platform.ApiException(401, "REFRESH_TOKEN_EXPIRED", "Sessão expirada. Entre novamente.");
        JwtClaimsSet claims = JwtClaimsSet.builder().issuer(properties.issuer()).audience(List.of(properties.audience()))
                .subject(session.userId.toString()).claim("sid", session.id.toString()).issuedAt(now).notBefore(now)
                .expiresAt(expires).id(UUID.randomUUID().toString()).claim("token_use", "access").build();
        String value = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(SignatureAlgorithm.RS256).build(), claims)).getTokenValue();
        return new IssuedAccess(value, expires, Duration.between(now, expires).toSeconds());
    }
    record IssuedAccess(String value, Instant expiresAt, long expiresIn) {}
}
