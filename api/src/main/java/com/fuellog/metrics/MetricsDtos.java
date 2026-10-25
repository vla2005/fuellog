package com.fuellog.metrics;

import com.fuellog.vehicles.FuelType;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

public final class MetricsDtos {
    private MetricsDtos() {}
    public enum UnavailableReason { NEEDS_FULL_TANK_BASELINE, OPEN_CYCLE, HISTORY_GAP, ZERO_DISTANCE, NO_VALID_CYCLE_IN_PERIOD }
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
}
