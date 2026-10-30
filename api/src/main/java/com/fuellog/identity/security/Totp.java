package com.fuellog.identity.security;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.Instant;
import java.util.Locale;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

@Component
public class Totp {
    private static final String ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private final SecureRandom random = new SecureRandom();

    public String newSecret() {
        byte[] bytes = new byte[20];
        random.nextBytes(bytes);
        StringBuilder value = new StringBuilder(32);
        int buffer = 0, bits = 0;
        for (byte b : bytes) {
            buffer = (buffer << 8) | (b & 255);
            bits += 8;
            while (bits >= 5) { bits -= 5; value.append(ALPHABET.charAt((buffer >>> bits) & 31)); }
        }
        return value.toString();
    }

    public byte[] decode(String secret) {
        if (secret == null || !secret.matches("[A-Z2-7]{32}")) throw new IllegalArgumentException("Invalid TOTP secret");
        byte[] bytes = new byte[20];
        int buffer = 0, bits = 0, index = 0;
        for (char c : secret.toCharArray()) {
            buffer = (buffer << 5) | ALPHABET.indexOf(c);
            bits += 5;
            if (bits >= 8) { bits -= 8; bytes[index++] = (byte) (buffer >>> bits); }
        }
        return bytes;
    }

    public String code(String secret, Instant time) { return generate(decode(secret), time.getEpochSecond() / 30, 6); }

    // The configurable digit count also permits the official RFC 6238 eight-digit vectors.
    public String generate(byte[] secret, long step, int digits) {
        if (digits != 6 && digits != 8) throw new IllegalArgumentException("Invalid TOTP digits");
        try {
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(secret, "HmacSHA1"));
            byte[] hash = mac.doFinal(ByteBuffer.allocate(8).putLong(step).array());
            int offset = hash[hash.length - 1] & 15;
            int binary = ByteBuffer.wrap(hash, offset, 4).getInt() & 0x7fffffff;
            return String.format(Locale.ROOT, "%0" + digits + "d", binary % (digits == 6 ? 1_000_000 : 100_000_000));
        } catch (GeneralSecurityException e) { throw new IllegalStateException("TOTP unavailable", e); }
    }

    public long matchingStep(String secret, String code, Instant time, long lastUsedStep) {
        if (code == null || !code.matches("[0-9]{6}")) return -1;
        byte[] key = decode(secret), submitted = code.getBytes(StandardCharsets.US_ASCII);
        long current = time.getEpochSecond() / 30, matched = -1;
        for (long step = current - 1; step <= current + 1; step++) {
            boolean equal = MessageDigest.isEqual(submitted, generate(key, step, 6).getBytes(StandardCharsets.US_ASCII));
            if (equal && step > lastUsedStep) matched = step;
        }
        return matched;
    }
}
