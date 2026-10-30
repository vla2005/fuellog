package com.fuellog.fueling.models;

import com.fuellog.fueling.dtos.FuelEntryDtos;
import com.fuellog.fueling.enums.TankState;
import com.fuellog.vehicles.enums.FuelType;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name="fuel_entries")
public class FuelEntry {
    @Id private UUID id;
    @Column(name="vehicle_id", nullable=false, updatable=false) private UUID vehicleId;
    @Column(name="occurred_at", nullable=false) private Instant occurredAt;
    @Column(nullable=false,length=64) private String timezone;
    @Column(name="odometer_km",nullable=false) private long odometerKm;
    @Enumerated(EnumType.STRING) @Column(name="fuel_type",nullable=false,length=32) private FuelType fuelType;
    @Column(nullable=false,precision=10,scale=3) private BigDecimal liters;
    @Column(name="unit_price",nullable=false,precision=10,scale=4) private BigDecimal unitPrice;
    @Column(name="paid_total",nullable=false,precision=12,scale=2) private BigDecimal paidTotal;
    @Column(name="adjustment_reason",length=300) private String adjustmentReason;
    @Enumerated(EnumType.STRING) @Column(name="tank_state",nullable=false,length=16) private TankState tankState;
    @Column(name="history_gap_before",nullable=false) private boolean historyGapBefore;
    @Column(name="station_name",length=120) private String stationName;
    @Column(length=1000) private String notes;
    @Column(precision=10,scale=7) private BigDecimal latitude;
    @Column(precision=10,scale=7) private BigDecimal longitude;
    @Column(name="create_request_hash",nullable=false,updatable=false,length=64) private String createRequestHash;
    @Column(name="created_at",nullable=false,updatable=false) private Instant createdAt;
    @Column(name="updated_at",nullable=false) private Instant updatedAt;
    @Version private Long version;
    public UUID id() { return id; }
    public UUID vehicleId() { return vehicleId; }
    public Instant occurredAt() { return occurredAt; }
    public long odometerKm() { return odometerKm; }
    public FuelType fuelType() { return fuelType; }
    public BigDecimal liters() { return liters; }
    public BigDecimal paidTotal() { return paidTotal; }
    public TankState tankState() { return tankState; }
    public boolean historyGapBefore() { return historyGapBefore; }
    public String createRequestHash() { return createRequestHash; }
    public Long version() { return version; }
    protected FuelEntry() {}
    public boolean hasSameAmounts(FuelCommand c) {
        return liters.compareTo(c.liters()) == 0 && unitPrice.compareTo(c.unitPrice()) == 0
            && paidTotal.compareTo(c.paidTotal()) == 0 && java.util.Objects.equals(adjustmentReason,c.adjustmentReason());
    }
    public FuelEntry(FuelCommand c, boolean pendingGap) {
        id=c.id(); vehicleId=c.vehicleId(); occurredAt=c.occurredAt(); timezone=c.timezone(); odometerKm=c.odometerKm();
        fuelType=c.fuelType(); liters=c.liters(); unitPrice=c.unitPrice(); paidTotal=c.paidTotal(); tankState=c.tankState();
        historyGapBefore=c.historyGapBefore() || pendingGap; adjustmentReason=c.adjustmentReason(); stationName=c.stationName();
        notes=c.notes(); latitude=c.latitude(); longitude=c.longitude(); createRequestHash=c.hash();
    }
    public void update(FuelCommand c) {
        occurredAt=c.occurredAt(); timezone=c.timezone(); odometerKm=c.odometerKm(); fuelType=c.fuelType();
        liters=c.liters(); unitPrice=c.unitPrice(); paidTotal=c.paidTotal(); tankState=c.tankState();
        historyGapBefore=c.historyGapBefore(); adjustmentReason=c.adjustmentReason(); stationName=c.stationName(); notes=c.notes();
        if (c.latitude() != null) { latitude=c.latitude(); longitude=c.longitude(); }
        // Accepted PUTs advance the version even when the submitted values are unchanged.
        updatedAt=Instant.now();
    }
    @PrePersist void createTime() { createdAt=updatedAt=Instant.now(); }
    @PreUpdate void updateTime() { updatedAt=Instant.now(); }
    public FuelEntryDtos.View view(boolean replay) {
        BigDecimal reference=FuelCommand.reference(liters,unitPrice);
        return new FuelEntryDtos.View(id,vehicleId,occurredAt,timezone,odometerKm,fuelType,liters.toPlainString(),
            unitPrice.toPlainString(),paidTotal.toPlainString(),reference.toPlainString(),paidTotal.subtract(reference).toPlainString(),
            tankState,historyGapBefore,adjustmentReason,stationName,notes,version,replay,latitude,longitude);
    }
}
