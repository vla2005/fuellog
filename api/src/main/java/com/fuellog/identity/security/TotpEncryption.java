package com.fuellog.identity.security;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.Base64;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class TotpEncryption {
    private final SecretKeySpec key;
    private final SecureRandom random = new SecureRandom();

    public TotpEncryption(@Value("${fuellog.security.totp-encryption-key-base64}") String encodedKey) {
        byte[] bytes;
        try { bytes = Base64.getDecoder().decode(encodedKey); }
        catch (IllegalArgumentException e) { throw new IllegalStateException("Configure a Base64 TOTP encryption key of 32 bytes"); }
        if (bytes.length != 32) throw new IllegalStateException("Configure a Base64 TOTP encryption key of 32 bytes");
        key = new SecretKeySpec(bytes, "AES");
    }

    public String encrypt(UUID userId, String secret) {
        byte[] nonce = new byte[12]; random.nextBytes(nonce);
        try {
            Cipher cipher = cipher(Cipher.ENCRYPT_MODE, userId, nonce);
            byte[] encrypted = cipher.doFinal(secret.getBytes(StandardCharsets.US_ASCII));
            return Base64.getEncoder().encodeToString(ByteBuffer.allocate(nonce.length + encrypted.length).put(nonce).put(encrypted).array());
        } catch (GeneralSecurityException e) { throw new IllegalStateException("TOTP encryption unavailable"); }
    }

    public String decrypt(UUID userId, String encryptedSecret) {
        try {
            ByteBuffer input = ByteBuffer.wrap(Base64.getDecoder().decode(encryptedSecret));
            byte[] nonce = new byte[12]; input.get(nonce);
            byte[] encrypted = new byte[input.remaining()]; input.get(encrypted);
            return new String(cipher(Cipher.DECRYPT_MODE, userId, nonce).doFinal(encrypted), StandardCharsets.US_ASCII);
        } catch (GeneralSecurityException | RuntimeException e) { throw new IllegalStateException("TOTP secret cannot be decrypted"); }
    }

    private Cipher cipher(int mode, UUID userId, byte[] nonce) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode, key, new GCMParameterSpec(128, nonce));
        cipher.updateAAD(userId.toString().getBytes(StandardCharsets.US_ASCII));
        return cipher;
    }
}
