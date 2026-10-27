package com.fuellog.identity.security;

import com.fuellog.identity.services.IdentityService;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.Base64;
import java.util.HexFormat;
import org.springframework.stereotype.Component;

@Component
public class RefreshSecrets {
    private final SecureRandom random = new SecureRandom();
    public String generate() {
        byte[] bytes = new byte[32]; random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
    public String hash(String secret) {
        if (secret == null || !secret.matches("[A-Za-z0-9_-]{43}")) throw IdentityService.invalidRefresh();
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(secret.getBytes(StandardCharsets.US_ASCII)));
        } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
