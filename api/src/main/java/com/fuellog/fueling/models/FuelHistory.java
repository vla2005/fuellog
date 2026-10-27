package com.fuellog.fueling.models;

import com.fuellog.fueling.enums.TankState;
import com.fuellog.vehicles.enums.FuelType;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** Read-only facts used to recalculate metrics from the complete history. */
public record FuelHistory(UUID id, Instant occurredAt, long odometerKm, FuelType fuelType,
    BigDecimal liters, BigDecimal paidTotal, TankState tankState, boolean historyGapBefore) {}
