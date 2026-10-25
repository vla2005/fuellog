package com.fuellog.identity;

import jakarta.persistence.*;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

@Entity
@Table(name = "user_sessions")
class UserSession {
    @Id UUID id;
    @Column(name = "user_id", nullable = false) UUID userId;
    @Column(name = "expires_at", nullable = false) Instant expiresAt;
    @Column(name = "revoked_at") Instant revokedAt;
    @Column(name = "revocation_reason", length = 40) String revocationReason;
    @Column(name = "device_label", length = 100) String deviceLabel;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    @Column(name = "last_used_at", nullable = false) Instant lastUsedAt;
    @Version long version;
    protected UserSession() {}
    UserSession(UUID userId, Instant now) {
        now = now.truncatedTo(java.time.temporal.ChronoUnit.MICROS);
        id = UUID.randomUUID(); this.userId = userId; createdAt = now; lastUsedAt = now;
        expiresAt = now.atZone(ZoneOffset.UTC).plusMonths(6).toInstant();
    }
    boolean activeAt(Instant now) { return revokedAt == null && now.isBefore(expiresAt); }
    void revoke(Instant now, String reason) { revokedAt = now; revocationReason = reason; }
}
