package com.fuellog.vikash.services;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.spec.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class ViKashEncryption {
    private final SecretKeySpec key;
    private final SecureRandom random=new SecureRandom();
    public ViKashEncryption(@Value("${fuellog.vikash.encryption-key-base64:}") String encoded) {
        if (encoded.isBlank()) { key=null; return; }
        byte[] bytes;
        try { bytes=Base64.getDecoder().decode(encoded); }
        catch (IllegalArgumentException e) { throw new IllegalStateException("ViKash encryption key must contain 32 Base64-encoded bytes"); }
        if (bytes.length != 32) throw new IllegalStateException("ViKash encryption key must contain 32 Base64-encoded bytes");
        key=new SecretKeySpec(bytes,"AES");
    }
    public boolean configured() { return key != null; }
    public String encrypt(UUID binding, String secret) {
        if (key == null) throw new IllegalStateException("ViKash encryption unavailable");
        byte[] nonce=new byte[12]; random.nextBytes(nonce);
        try {
            byte[] result=cipher(Cipher.ENCRYPT_MODE,binding,nonce).doFinal(secret.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(ByteBuffer.allocate(12+result.length).put(nonce).put(result).array());
        } catch (GeneralSecurityException e) { throw new IllegalStateException("ViKash encryption unavailable"); }
    }
    public String decrypt(UUID binding, String encrypted) {
        try {
            ByteBuffer buffer=ByteBuffer.wrap(Base64.getDecoder().decode(encrypted));
            byte[] nonce=new byte[12]; buffer.get(nonce); byte[] value=new byte[buffer.remaining()]; buffer.get(value);
            return new String(cipher(Cipher.DECRYPT_MODE,binding,nonce).doFinal(value),StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | RuntimeException e) { throw new IllegalStateException("ViKash credential cannot be decrypted"); }
    }
    private Cipher cipher(int mode, UUID binding, byte[] nonce) throws GeneralSecurityException {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(mode,key,new GCMParameterSpec(128,nonce));
        cipher.updateAAD(binding.toString().getBytes(StandardCharsets.US_ASCII));
        return cipher;
    }
}
