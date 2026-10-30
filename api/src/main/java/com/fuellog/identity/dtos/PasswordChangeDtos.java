package com.fuellog.identity.dtos;

public final class PasswordChangeDtos {
    private PasswordChangeDtos() {}
    public record ChangePassword(String currentPassword, String newPassword, String secondFactorCode) {
        @Override public String toString() { return "ChangePassword[REDACTED]"; }
    }
}
