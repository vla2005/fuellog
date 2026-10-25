package com.fuellog.identity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "users")
class UserAccount {
    @Id UUID id;
    @Column(nullable = false, length = 100) String name;
    @Column(nullable = false, unique = true, length = 254) String email;
    @Column(name = "password_hash", nullable = false, columnDefinition = "text") String passwordHash;
    @Column(name = "disabled_at") Instant disabledAt;
    @Column(name = "preferred_timezone", nullable = false, length = 64) String preferredTimezone;
    @Column(name = "created_at", nullable = false) Instant createdAt;
    @Column(name = "updated_at", nullable = false) Instant updatedAt;
    @Version long version;
    protected UserAccount() {}
    UserAccount(String name, String email, String passwordHash, Instant now) {
        this.id = UUID.randomUUID(); this.name = name; this.email = email;
        this.passwordHash = passwordHash; this.preferredTimezone = "America/Sao_Paulo";
        this.createdAt = now; this.updatedAt = now;
    }
}
