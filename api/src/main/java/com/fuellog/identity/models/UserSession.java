package com.fuellog.identity.models;

import jakarta.persistence.*;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

@Entity
@Table(name = "user_sessions")
public class UserSession {
    @Id private UUID id;
    @Column(name = "user_id", nullable = false) private UUID userId;
    @Column(name = "expires_at", nullable = false) private Instant expiresAt;
    @Column(name = "revoked_at") private Instant revokedAt;
    @Column(name = "revocation_reason", length = 40) private String revocationReason;
    @Column(name = "device_label", length = 100) private String deviceLabel;
    // Reenrollments and active sessions point directly to the root remembered session.
    @Column(name = "biometric_parent_session_id") private UUID biometricParentSessionId;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "last_used_at", nullable = false) private Instant lastUsedAt;
    @Version private long version;
    public UUID id() { return id; }
    public UUID userId() { return userId; }
    public Instant expiresAt() { return expiresAt; }
    public Instant revokedAt() { return revokedAt; }
    public boolean biometricLogin() { return "BIOMETRIC_LOGIN".equals(deviceLabel); }
    public UUID biometricParentSessionId() { return biometricParentSessionId; }
    public void recordUse(Instant now) { lastUsedAt = now; }
    protected UserSession() {}
    public UserSession(UUID userId, Instant now) {
        now = now.truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        id = UUID.randomUUID(); this.userId = userId; createdAt = now; lastUsedAt = now;
        expiresAt = now.atZone(ZoneOffset.UTC).plusMonths(6).toInstant();
    }
    public static UserSession forBiometricLogin(UserSession current, Instant now) {
        UserSession session = new UserSession(current.userId(), now);
        session.deviceLabel = "BIOMETRIC_LOGIN";
        session.biometricParentSessionId = current.biometricParentSessionId;
        return session;
    }
    public static UserSession fromBiometricLogin(UserSession biometric, Instant now) {
        UserSession session = new UserSession(biometric.userId(), now);
        session.biometricParentSessionId = biometric.biometricParentSessionId == null ? biometric.id() : biometric.biometricParentSessionId;
        return session;
    }
    public boolean activeAt(Instant now) { return revokedAt == null && now.isBefore(expiresAt); }
    public void revoke(Instant now, String reason) { revokedAt = now; revocationReason = reason; }
}
