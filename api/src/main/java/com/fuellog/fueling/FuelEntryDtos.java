package com.fuellog.fueling;

import com.fuellog.vehicles.FuelType;
import tools.jackson.databind.annotation.JsonDeserialize;
import java.time.*;
import java.math.BigDecimal;
import java.util.*;

public final class FuelEntryDtos {
    private FuelEntryDtos() {}
    public record Create(UUID id, OffsetDateTime occurredAt, String timezone, @JsonDeserialize(using=StrictOdometer.class) Long odometerKm, FuelType fuelType,
        @JsonDeserialize(using=StrictDecimalString.class) String liters,
        @JsonDeserialize(using=StrictDecimalString.class) String unitPrice,
        @JsonDeserialize(using=StrictDecimalString.class) String paidTotal,
        TankState tankState, Boolean historyGapBefore, String adjustmentReason, String stationName, String notes,
        @JsonDeserialize(using=StrictCoordinate.class) BigDecimal latitude,
        @JsonDeserialize(using=StrictCoordinate.class) BigDecimal longitude) {}
    public record View(UUID id, UUID vehicleId, Instant occurredAt, String timezone, long odometerKm, FuelType fuelType,
        String liters, String unitPrice, String paidTotal, String referenceTotal, String adjustmentAmount,
        TankState tankState, boolean historyGapBefore, String adjustmentReason, String stationName, String notes,
        Long version, boolean idempotentReplay, BigDecimal latitude, BigDecimal longitude) {}
    public record Page(List<View> items, int page, int size, long totalElements, int totalPages) {}
}
