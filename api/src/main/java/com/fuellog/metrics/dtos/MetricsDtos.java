package com.fuellog.metrics.dtos;

import com.fuellog.vehicles.enums.FuelType;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class MetricsDtos {
    private MetricsDtos() {}
    public record Summary(UUID vehicleId, LocalDate from, LocalDate to, String timezone,
        long purchaseCount, String paidTotal, String purchasedLiters, String weightedPaidPrice) {}
    public record MonthlyTotal(String month, LocalDate from, LocalDate to, long purchaseCount, String paidTotal, String liters) {}
    public record FuelSpending(FuelType fuelType, long purchaseCount, String paidTotal, String liters, String percentage) {}
    public record Price(UUID entryId, Instant occurredAt, FuelType fuelType, String unitPrice, String liters, String paidTotal) {}
    public record Dashboard(UUID vehicleId, LocalDate from, LocalDate to, String timezone, FuelType fuelType,
        long purchaseCount, String paidTotal, String purchasedLiters, String weightedUnitPrice,
        List<MonthlyTotal> months, List<FuelSpending> fuels, List<Price> prices) {}
}
