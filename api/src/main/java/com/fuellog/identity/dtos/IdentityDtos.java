package com.fuellog.identity.dtos;

import java.time.Instant;
import java.util.UUID;
import jakarta.validation.constraints.*;

public final class IdentityDtos {
    private IdentityDtos() {}
    public record Register(@NotBlank @Size(max=100) String name, @NotBlank @Email @Size(max=254) String email,
                    @NotBlank @Size(min=6, max=128) String password) {}
    public record Login(@NotBlank @Email @Size(max=254) String email, @NotBlank @Size(max=128) String password) {}
    public record Refresh(@NotBlank @Pattern(regexp="[A-Za-z0-9_-]{43}") String refresh_token) {}
    public record RegisteredUser(UUID id, String name, String email) {}
    public record Me(UUID id, String name, String email, String preferredTimezone) {}
    public record TokenResponse(String access_token, String token_type, long expires_in, Instant access_expires_at,
            String refresh_token, Instant refresh_expires_at, UUID session_id) {}
}
