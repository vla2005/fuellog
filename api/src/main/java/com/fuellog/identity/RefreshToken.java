package com.fuellog.identity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "refresh_tokens")
class RefreshToken {
    @Id UUID id;
    @Column(name = "session_id", nullable = false) UUID sessionId;
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.CHAR)
    @Column(name = "token_hash", nullable = false, unique = true, length = 64, columnDefinition = "char(64)") String tokenHash;
    @Column(name = "issued_at", nullable = false) Instant issuedAt;
    @Column(name = "expires_at", nullable = false) Instant expiresAt;
    @Column(name = "used_at") Instant usedAt;
    @Column(name = "revoked_at") Instant revokedAt;
    @Column(name = "replaced_by_id") UUID replacedById;
    protected RefreshToken() {}
    RefreshToken(UUID sessionId, String tokenHash, Instant now, Instant expiresAt) {
        id = UUID.randomUUID(); this.sessionId = sessionId; this.tokenHash = tokenHash;
        issuedAt = now; this.expiresAt = expiresAt;
    }
}
