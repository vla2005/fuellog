package com.fuellog.identity.security;

import static org.assertj.core.api.Assertions.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;

class TotpTest {
    private final Totp totp = new Totp();
    private final String secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    @Test void officialRfc6238Sha1VectorsIncludeTimesBeyond2038() {
        long[] times = {59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000L};
        String[] expected = {"94287082", "07081804", "14050471", "89005924", "69279037", "65353130"};
        byte[] key = "12345678901234567890".getBytes(StandardCharsets.US_ASCII);
        for (int i = 0; i < times.length; i++) assertThat(totp.generate(key, times[i] / 30, 8)).isEqualTo(expected[i]);
        assertThat(totp.decode(secret)).isEqualTo(key);
        assertThat(totp.code(secret, Instant.ofEpochSecond(59))).isEqualTo("287082");
    }

    @Test void acceptsOnlyOneAdjacentStepAndNeverReusesAnAcceptedStep() {
        Instant now = Instant.ofEpochSecond(1234567890);
        long step = now.getEpochSecond() / 30;
        for (int adjacent : new int[]{-1, 0, 1}) {
            String code = totp.code(secret, now.plusSeconds(adjacent * 30L));
            assertThat(totp.matchingStep(secret, code, now, -1)).isEqualTo(step + adjacent);
            assertThat(totp.matchingStep(secret, code, now, step + adjacent)).isEqualTo(-1);
        }
        for (int outside : new int[]{-2, 2})
            assertThat(totp.matchingStep(secret, totp.code(secret, now.plusSeconds(outside * 30L)), now, -1)).isEqualTo(-1);
        for (String malformed : new String[]{null, "", "12345", "1234567", "１２３４５６", " 287082"})
            assertThat(totp.matchingStep(secret, malformed, now, -1)).isEqualTo(-1);
        assertThat(totp.code(secret, Instant.ofEpochSecond(29))).isNotEqualTo(totp.code(secret, Instant.ofEpochSecond(30)));
    }

    @Test void secretsContain160RandomBitsAndEncryptionIsRandomizedAndUserBound() {
        String first = totp.newSecret(), second = totp.newSecret();
        assertThat(first).matches("[A-Z2-7]{32}").isNotEqualTo(second);
        assertThat(totp.decode(first)).hasSize(20);
        var cipher = new TotpEncryption("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=");
        UUID user = UUID.randomUUID();
        String encrypted = cipher.encrypt(user, first);
        assertThat(encrypted).isNotEqualTo(cipher.encrypt(user, first)).doesNotContain(first);
        assertThat(cipher.decrypt(user, encrypted)).isEqualTo(first);
        assertThatThrownBy(() -> cipher.decrypt(UUID.randomUUID(), encrypted)).isInstanceOf(IllegalStateException.class);
        byte[] changed = Base64.getDecoder().decode(encrypted); changed[changed.length - 1] ^= 1;
        assertThatThrownBy(() -> cipher.decrypt(user, Base64.getEncoder().encodeToString(changed))).isInstanceOf(IllegalStateException.class);
        for (String invalidKey : List.of("", "not base64", "YQ=="))
            assertThatThrownBy(() -> new TotpEncryption(invalidKey)).isInstanceOf(IllegalStateException.class)
                    .hasMessage("Configure a Base64 TOTP encryption key of 32 bytes");
    }

    @Test void sensitiveDtosRedactSecretsCodesAndChallengesFromTheirStringRepresentation() {
        String value = "sensitive-value";
        assertThat(new com.fuellog.identity.dtos.TwoFactorDtos.SetupResponse(value, value, Instant.EPOCH).toString()).doesNotContain(value);
        assertThat(new com.fuellog.identity.dtos.TwoFactorDtos.Challenge(true, value, Instant.EPOCH).toString()).doesNotContain(value);
        assertThat(new com.fuellog.identity.dtos.TwoFactorDtos.RecoveryCodes(List.of(value)).toString()).doesNotContain(value);
        assertThat(new com.fuellog.identity.dtos.TwoFactorDtos.Verify(value, value).toString()).doesNotContain(value);
    }
}
