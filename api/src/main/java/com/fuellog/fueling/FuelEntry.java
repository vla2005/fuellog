package com.fuellog.fueling;

import com.fuellog.vehicles.FuelType;
import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name="fuel_entries")
class FuelEntry {
    @Id UUID id;
    @Column(name="vehicle_id", nullable=false, updatable=false) UUID vehicleId;
    @Column(name="occurred_at", nullable=false) Instant occurredAt;
    @Column(nullable=false,length=64) String timezone;
    @Column(name="odometer_km",nullable=false) long odometerKm;
    @Enumerated(EnumType.STRING) @Column(name="fuel_type",nullable=false,length=32) FuelType fuelType;
    @Column(nullable=false,precision=10,scale=3) BigDecimal liters;
    @Column(name="unit_price",nullable=false,precision=10,scale=4) BigDecimal unitPrice;
    @Column(name="paid_total",nullable=false,precision=12,scale=2) BigDecimal paidTotal;
    @Column(name="adjustment_reason",length=300) String adjustmentReason;
    @Enumerated(EnumType.STRING) @Column(name="tank_state",nullable=false,length=16) TankState tankState;
    @Column(name="history_gap_before",nullable=false) boolean historyGapBefore;
    @Column(name="station_name",length=120) String stationName;
    @Column(length=1000) String notes;
    @Column(precision=10,scale=7) BigDecimal latitude;
    @Column(precision=10,scale=7) BigDecimal longitude;
    @Column(name="create_request_hash",nullable=false,updatable=false,length=64) String createRequestHash;
    @Column(name="created_at",nullable=false,updatable=false) Instant createdAt;
    @Column(name="updated_at",nullable=false) Instant updatedAt;
    @Version Long version;
    protected FuelEntry() {}
    FuelEntry(FuelCommand c, boolean pendingGap) {
        id=c.id(); vehicleId=c.vehicleId(); occurredAt=c.occurredAt(); timezone=c.timezone(); odometerKm=c.odometerKm();
        fuelType=c.fuelType(); liters=c.liters(); unitPrice=c.unitPrice(); paidTotal=c.paidTotal(); tankState=c.tankState();
        historyGapBefore=c.historyGapBefore() || pendingGap; adjustmentReason=c.adjustmentReason(); stationName=c.stationName();
        notes=c.notes(); latitude=c.latitude(); longitude=c.longitude(); createRequestHash=c.hash();
    }
    @PrePersist void createTime() { createdAt=updatedAt=Instant.now(); }
    @PreUpdate void updateTime() { updatedAt=Instant.now(); }
    FuelEntryDtos.View view(boolean replay) {
        BigDecimal reference=FuelCommand.reference(liters,unitPrice);
        return new FuelEntryDtos.View(id,vehicleId,occurredAt,timezone,odometerKm,fuelType,liters.toPlainString(),
            unitPrice.toPlainString(),paidTotal.toPlainString(),reference.toPlainString(),paidTotal.subtract(reference).toPlainString(),
            tankState,historyGapBefore,adjustmentReason,stationName,notes,version,replay,latitude,longitude);
    }
}
