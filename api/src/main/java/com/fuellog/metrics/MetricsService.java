package com.fuellog.metrics;

import com.fuellog.fueling.DomainValues;
import com.fuellog.fueling.FuelHistory;
import com.fuellog.fueling.FuelHistoryService;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import static com.fuellog.metrics.MetricsDtos.*;

@Service
public class MetricsService {
    private final FuelHistoryService history;
    private final ConsumptionCalculator calculator=new ConsumptionCalculator();
    public MetricsService(FuelHistoryService history) { this.history=history; }

    public Summary summary(UUID vehicleId, LocalDate from, LocalDate to, String timezone) {
        var records=history.read(vehicleId);
        var period=Period.of(from,to,timezone);
        var result=calculator.calculate(records);
        var purchases=records.stream().filter(e -> period.contains(e.occurredAt())).toList();
        BigDecimal paid=BigDecimal.ZERO, liters=BigDecimal.ZERO;
        for (FuelHistory entry:purchases) { paid=paid.add(entry.paidTotal()); liters=liters.add(entry.liters()); }
        var selected=result.cycles().stream().filter(c -> period.contains(c.endedAt())).toList();
        var valid=selected.stream().filter(c -> c.unavailableReason() == null).toList();
        long distance=0;
        BigDecimal cycleLiters=BigDecimal.ZERO, cyclePaid=BigDecimal.ZERO;
        for (Cycle cycle:valid) {
            distance+=cycle.distanceKm(); cycleLiters=cycleLiters.add(new BigDecimal(cycle.liters()));
            cyclePaid=cyclePaid.add(new BigDecimal(cycle.paidTotal()));
        }
        Cycle last=null;
        for (Cycle cycle:result.cycles()) if (cycle.unavailableReason() == null) last=cycle;
        UnavailableReason missing=result.currentUnavailableReason();
        if (!selected.isEmpty()) missing=selected.getLast().unavailableReason();
        if (valid.isEmpty() && last != null) missing=UnavailableReason.NO_VALID_CYCLE_IN_PERIOD;
        if (valid.isEmpty() && missing == null) missing=UnavailableReason.OPEN_CYCLE;
        return new Summary(vehicleId,from,to,timezone,purchases.size(),paid.setScale(2).toPlainString(),liters.setScale(3).toPlainString(),
            ConsumptionCalculator.divide(paid,liters,4),valid.size(),distance,cycleLiters.setScale(3).toPlainString(),
            ConsumptionCalculator.divide(BigDecimal.valueOf(distance),cycleLiters,2),
            valid.isEmpty() ? null : ConsumptionCalculator.divide(cyclePaid,BigDecimal.valueOf(distance),4),
            valid.isEmpty() ? missing : null,last,last == null ? result.currentUnavailableReason() : null);
    }

    public Cycles cycles(UUID vehicleId, LocalDate from, LocalDate to, String timezone) {
        var records=history.read(vehicleId);
        var period=Period.of(from,to,timezone);
        var result=calculator.calculate(records);
        return new Cycles(vehicleId,from,to,timezone,result.cycles().stream()
            .filter(c -> period.contains(c.endedAt())).toList(),result.currentUnavailableReason());
    }

    private record Period(Instant start, Instant end) {
        static Period of(LocalDate from, LocalDate to, String timezone) {
            ZoneId zone=DomainValues.zone(timezone);
            if (from != null && to != null && from.isAfter(to)) throw DomainValues.invalid("to","Fim anterior ao início.");
            try {
                return new Period(from == null ? null : from.atStartOfDay(zone).toInstant(),
                    to == null ? null : to.plusDays(1).atStartOfDay(zone).toInstant());
            } catch (DateTimeException e) { throw DomainValues.invalid("to","Data fora da faixa suportada."); }
        }
        boolean contains(Instant instant) { return (start == null || !instant.isBefore(start)) && (end == null || instant.isBefore(end)); }
    }
}
