package com.fuellog.metrics.dtos;

import com.fuellog.metrics.enums.UnavailableReason;
import com.fuellog.vehicles.enums.FuelType;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class MetricsDtos {
    private MetricsDtos() {}
    public record Cycle(UUID startEntryId, UUID endEntryId, Instant startedAt, Instant endedAt,
        long distanceKm, String liters, String paidTotal, String consumptionKmPerLiter,
        String replacementCostPerKm, List<FuelType> fuelTypes, boolean mixed, UnavailableReason unavailableReason) {}
    public record Cycles(UUID vehicleId, LocalDate from, LocalDate to, String timezone,
        List<Cycle> items, UnavailableReason currentUnavailableReason) {}
    public record Summary(UUID vehicleId, LocalDate from, LocalDate to, String timezone,
        long purchaseCount, String paidTotal, String purchasedLiters, String weightedPaidPrice,
        int validCycleCount, long cycleDistanceKm, String cycleLiters, String periodConsumptionKmPerLiter,
        String periodReplacementCostPerKm, UnavailableReason periodUnavailableReason,
        Cycle lastValidCycle, UnavailableReason lastConsumptionUnavailableReason) {}
    public record MonthlyTotal(String month, LocalDate from, LocalDate to, long purchaseCount, String paidTotal, String liters) {}
    public record FuelSpending(FuelType fuelType, long purchaseCount, String paidTotal, String liters, String percentage) {}
    public record Price(UUID entryId, Instant occurredAt, FuelType fuelType, String unitPrice, String liters, String paidTotal) {}
    public record Dashboard(UUID vehicleId, LocalDate from, LocalDate to, String timezone, FuelType fuelType,
        long purchaseCount, String paidTotal, String purchasedLiters, String weightedUnitPrice,
        int validCycleCount, long cycleDistanceKm, String cycleLiters, String cyclePaidTotal,
        String consumptionKmPerLiter, String replacementCostPerKm, UnavailableReason unavailableReason,
        List<MonthlyTotal> months, List<FuelSpending> fuels, List<Price> prices, List<Cycle> cycles) {}
}
