package com.fuellog.identity.dtos;

import java.time.Instant;
import java.util.List;
import jakarta.validation.constraints.*;

public final class TwoFactorDtos {
    private TwoFactorDtos() {}
    public record Status(boolean enabled, int recoveryCodesRemaining) {}
    public record Setup(@NotBlank @Size(max=128) String currentPassword) {
        @Override public String toString() { return "Setup[redacted]"; }
    }
    public record SetupResponse(String secret, String otpauthUri, Instant expiresAt) {
        @Override public String toString() { return "SetupResponse[redacted]"; }
    }
    public record Enable(@Size(max=128) String code) {
        @Override public String toString() { return "Enable[redacted]"; }
    }
    public record RecoveryCodes(List<String> recoveryCodes) {
        @Override public String toString() { return "RecoveryCodes[redacted]"; }
    }
    public record Disable(@NotBlank @Size(max=128) String currentPassword, @Size(max=128) String code) {
        @Override public String toString() { return "Disable[redacted]"; }
    }
    public record Challenge(boolean mfaRequired, String challengeToken, Instant expiresAt) implements IdentityDtos.LoginResult {
        @Override public String toString() { return "Challenge[redacted]"; }
    }
    public record Verify(@Size(max=128) String challengeToken, @Size(max=128) String code) {
        @Override public String toString() { return "Verify[redacted]"; }
    }
}
