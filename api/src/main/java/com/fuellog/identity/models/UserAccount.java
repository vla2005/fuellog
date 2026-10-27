package com.fuellog.identity.models;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "users")
public class UserAccount {
    @Id private UUID id;
    @Column(nullable = false, length = 100) private String name;
    @Column(nullable = false, unique = true, length = 254) private String email;
    @Column(name = "password_hash", nullable = false, columnDefinition = "text") private String passwordHash;
    @Column(name = "disabled_at") private Instant disabledAt;
    @Column(name = "preferred_timezone", nullable = false, length = 64) private String preferredTimezone;
    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;
    @Version private long version;
    public UUID id() { return id; }
    public String name() { return name; }
    public String email() { return email; }
    public String passwordHash() { return passwordHash; }
    public Instant disabledAt() { return disabledAt; }
    public String preferredTimezone() { return preferredTimezone; }
    protected UserAccount() {}
    public UserAccount(String name, String email, String passwordHash, Instant now) {
        this.id = UUID.randomUUID(); this.name = name; this.email = email;
        this.passwordHash = passwordHash; this.preferredTimezone = "America/Sao_Paulo";
        this.createdAt = now; this.updatedAt = now;
    }
}
