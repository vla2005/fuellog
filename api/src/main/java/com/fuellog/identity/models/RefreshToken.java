package com.fuellog.identity.models;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "refresh_tokens")
public class RefreshToken {
    @Id private UUID id;
    @Column(name = "session_id", nullable = false) private UUID sessionId;
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.CHAR)
    @Column(name = "token_hash", nullable = false, unique = true, length = 64, columnDefinition = "char(64)") private String tokenHash;
    @Column(name = "issued_at", nullable = false) private Instant issuedAt;
    @Column(name = "expires_at", nullable = false) private Instant expiresAt;
    @Column(name = "used_at") private Instant usedAt;
    @Column(name = "revoked_at") private Instant revokedAt;
    @Column(name = "replaced_by_id") private UUID replacedById;
    public UUID id() { return id; }
    public Instant expiresAt() { return expiresAt; }
    public Instant usedAt() { return usedAt; }
    public Instant revokedAt() { return revokedAt; }
    public void markUsed(Instant now) { usedAt = now; }
    public void replaceWith(UUID tokenId) { replacedById = tokenId; }
    protected RefreshToken() {}
    public RefreshToken(UUID sessionId, String tokenHash, Instant now, Instant expiresAt) {
        id = UUID.randomUUID(); this.sessionId = sessionId; this.tokenHash = tokenHash;
        issuedAt = now; this.expiresAt = expiresAt;
    }
}
