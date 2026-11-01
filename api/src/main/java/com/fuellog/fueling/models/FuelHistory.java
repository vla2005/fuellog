package com.fuellog.fueling.models;

import com.fuellog.vehicles.enums.FuelType;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** Read-only purchase facts used to aggregate the complete active history. */
public record FuelHistory(UUID id, Instant occurredAt, long odometerKm, FuelType fuelType,
    BigDecimal liters, BigDecimal paidTotal, BigDecimal unitPrice) {}
