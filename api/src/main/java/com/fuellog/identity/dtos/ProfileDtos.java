package com.fuellog.identity.dtos;

public final class ProfileDtos {
    private ProfileDtos() {}
    public record UpdateProfile(String name, String email, String currentPassword, String secondFactorCode) {
        @Override public String toString() { return "UpdateProfile[REDACTED]"; }
    }
}
