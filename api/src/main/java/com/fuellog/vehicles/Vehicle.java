package com.fuellog.vehicles;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

@Entity
@Table(name = "vehicles")
public class Vehicle {
    @Id private UUID id;
    @Column(name="user_id", nullable=false, updatable=false) private UUID userId;
    @Column(nullable=false, length=60) private String nickname;
    @Column(length=80) private String brand;
    @Column(length=80) private String model;
    @Column(name="model_year") private Short modelYear;
    @Column(length=16) private String plate;
    @Column(name="tank_capacity_liters", precision=8, scale=3) private BigDecimal tankCapacityLiters;
    @Column(name="archived_at") private Instant archivedAt;
    @Column(name="pending_history_gap_after") private Instant pendingHistoryGapAfter;
    @Column(name="created_at", nullable=false, updatable=false) private Instant createdAt;
    @Column(name="updated_at", nullable=false) private Instant updatedAt;
    @Version private Long version;
    @ElementCollection
    @CollectionTable(name="vehicle_allowed_fuels", joinColumns=@JoinColumn(name="vehicle_id"))
    @Column(name="fuel_type", nullable=false, length=32)
    @Enumerated(EnumType.STRING)
    private Set<FuelType> allowedFuels = new HashSet<>();
    protected Vehicle() {}
    Vehicle(UUID userId, VehicleDtos.Create command) {
        this.id = UUID.randomUUID(); this.userId=userId; this.nickname=command.nickname();
        this.brand=command.brand(); this.model=command.model();
        this.modelYear=command.modelYear() == null ? null : command.modelYear().shortValue();
        this.plate=command.plate();
        this.tankCapacityLiters=command.tankCapacityLiters() == null ? null : new BigDecimal(command.tankCapacityLiters());
        this.allowedFuels.addAll(command.allowedFuels());
    }
    @PrePersist void createTime() { createdAt=updatedAt=Instant.now(); }
    @PreUpdate void updateTime() { updatedAt=Instant.now(); }
    public UUID id() { return id; }
    public Instant archivedAt() { return archivedAt; }
    public Set<FuelType> allowedFuels() { return Collections.unmodifiableSet(allowedFuels); }
    public Instant pendingHistoryGapAfter() { return pendingHistoryGapAfter; }
    public void consumePendingGap() { pendingHistoryGapAfter=null; }
    VehicleDtos.View view() {
        return new VehicleDtos.View(id,nickname,brand,model,modelYear == null ? null : modelYear.intValue(),plate,
            tankCapacityLiters == null ? null : tankCapacityLiters.toPlainString(),Set.copyOf(allowedFuels),archivedAt,version);
    }
}
