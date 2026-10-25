package com.fuellog.fueling;

import com.fuellog.vehicles.FuelType;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** Read-only facts used to recalculate metrics from the complete history. */
public record FuelHistory(UUID id, Instant occurredAt, long odometerKm, FuelType fuelType,
    BigDecimal liters, BigDecimal paidTotal, TankState tankState, boolean historyGapBefore) {}
