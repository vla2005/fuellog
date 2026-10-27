package com.fuellog.metrics.services;

import com.fuellog.fueling.enums.TankState;
import com.fuellog.fueling.models.FuelHistory;
import com.fuellog.metrics.enums.UnavailableReason;
import com.fuellog.vehicles.enums.FuelType;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import static com.fuellog.metrics.dtos.MetricsDtos.*;

final class ConsumptionCalculator {
    record Result(List<Cycle> cycles, UnavailableReason currentUnavailableReason) {}

    Result calculate(List<FuelHistory> history) {
        var cycles=new ArrayList<Cycle>();
        FuelHistory baseline=null;
        BigDecimal liters=BigDecimal.ZERO, paid=BigDecimal.ZERO;
        var fuels=EnumSet.noneOf(FuelType.class);
        boolean gap=false;
        UnavailableReason reason=UnavailableReason.NEEDS_FULL_TANK_BASELINE;
        for (FuelHistory entry:history) {
            if (entry.historyGapBefore()) { gap=true; reason=UnavailableReason.HISTORY_GAP; }
            if (baseline != null) {
                liters=liters.add(entry.liters()); paid=paid.add(entry.paidTotal()); fuels.add(entry.fuelType());
                if (entry.tankState() == TankState.FULL) {
                    long distance=entry.odometerKm()-baseline.odometerKm();
                    UnavailableReason invalid=gap ? UnavailableReason.HISTORY_GAP : distance <= 0 ? UnavailableReason.ZERO_DISTANCE : null;
                    cycles.add(new Cycle(baseline.id(),entry.id(),baseline.occurredAt(),entry.occurredAt(),distance,
                        liters.setScale(3).toPlainString(),paid.setScale(2).toPlainString(),invalid == null ? divide(BigDecimal.valueOf(distance),liters,2) : null,
                        invalid == null ? divide(paid,BigDecimal.valueOf(distance),4) : null,List.copyOf(fuels),fuels.size()>1,invalid));
                    reason=invalid;
                } else if (!gap) reason=UnavailableReason.OPEN_CYCLE;
            }
            if (entry.tankState() == TankState.FULL) {
                baseline=entry; liters=BigDecimal.ZERO; paid=BigDecimal.ZERO; fuels.clear(); gap=false;
                if (cycles.isEmpty()) reason=UnavailableReason.OPEN_CYCLE;
            }
        }
        return new Result(List.copyOf(cycles),reason);
    }
    static String divide(BigDecimal numerator, BigDecimal denominator, int scale) {
        return denominator.signum() == 0 ? null : numerator.divide(denominator,scale,RoundingMode.HALF_UP).toPlainString();
    }
}
