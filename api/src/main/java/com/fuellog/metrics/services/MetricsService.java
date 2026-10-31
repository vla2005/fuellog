package com.fuellog.metrics.services;

import com.fuellog.fueling.models.FuelHistory;
import com.fuellog.fueling.services.FuelHistoryService;
import com.fuellog.metrics.enums.UnavailableReason;
import com.fuellog.platform.validation.DomainValues;
import com.fuellog.vehicles.enums.FuelType;

import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import static com.fuellog.metrics.dtos.MetricsDtos.*;

@Service
public class MetricsService {
    private final FuelHistoryService history;
    private final ConsumptionCalculator calculator=new ConsumptionCalculator();
    public MetricsService(FuelHistoryService history) { this.history=history; }

    public Dashboard dashboard(UUID vehicleId, LocalDate from, LocalDate to, String timezone, FuelType fuelType) {
        var records=history.read(vehicleId);
        var period=Period.of(from,to,timezone);
        var zone=DomainValues.zone(timezone);
        var result=calculator.calculate(records);
        var months=new TreeMap<YearMonth,Totals>();
        var fuels=new EnumMap<FuelType,Totals>(FuelType.class);
        var prices=new ArrayList<Price>();
        var total=new Totals();
        BigDecimal declaredCost=BigDecimal.ZERO, declaredLiters=BigDecimal.ZERO;
        for (FuelHistory entry:records) {
            if (entry.deleted() || !period.contains(entry.occurredAt()) || fuelType != null && entry.fuelType() != fuelType) continue;
            total.add(entry);
            months.computeIfAbsent(YearMonth.from(entry.occurredAt().atZone(zone)),key->new Totals()).add(entry);
            fuels.computeIfAbsent(entry.fuelType(),key->new Totals()).add(entry);
            if (entry.unitPrice() != null) {
                declaredCost=declaredCost.add(entry.unitPrice().multiply(entry.liters()));
                declaredLiters=declaredLiters.add(entry.liters());
                prices.add(new Price(entry.id(),entry.occurredAt(),entry.fuelType(),entry.unitPrice().setScale(4).toPlainString(),
                    entry.liters().setScale(3).toPlainString(),entry.paidTotal().setScale(2).toPlainString()));
            }
        }
        // A fuel-specific efficiency is only meaningful for a complete, pure cycle.
        var cycles=result.cycles().stream().filter(c->period.contains(c.endedAt()))
            .filter(c->fuelType == null || c.fuelTypes().size() == 1 && c.fuelTypes().contains(fuelType)).toList();
        int valid=0;
        long distance=0;
        BigDecimal cycleLiters=BigDecimal.ZERO,cyclePaid=BigDecimal.ZERO;
        for (Cycle cycle:cycles) if (cycle.unavailableReason() == null) {
            valid++; distance+=cycle.distanceKm(); cycleLiters=cycleLiters.add(new BigDecimal(cycle.liters()));
            cyclePaid=cyclePaid.add(new BigDecimal(cycle.paidTotal()));
        }
        var monthly=months.entrySet().stream().map(e->{
            var month=e.getKey(); var values=e.getValue();
            LocalDate start=month.atDay(1), end=month.atEndOfMonth();
            return new MonthlyTotal(month.toString(),from != null && from.isAfter(start) ? from : start,
                to != null && to.isBefore(end) ? to : end,values.count,values.paid(),values.volume());
        }).toList();
        var byFuel=fuels.entrySet().stream().map(e->new FuelSpending(e.getKey(),e.getValue().count,e.getValue().paid(),e.getValue().volume(),
            ConsumptionCalculator.divide(e.getValue().paid.multiply(BigDecimal.valueOf(100)),total.paid,4))).toList();
        var reason=valid > 0 ? null : cycles.isEmpty() ? UnavailableReason.NO_VALID_CYCLE_IN_PERIOD : cycles.getLast().unavailableReason();
        if (reason == UnavailableReason.NO_VALID_CYCLE_IN_PERIOD && result.cycles().isEmpty()) reason=result.currentUnavailableReason();
        return new Dashboard(vehicleId,from,to,timezone,fuelType,total.count,total.paid(),total.volume(),
            ConsumptionCalculator.divide(declaredCost,declaredLiters,4),valid,distance,cycleLiters.setScale(3).toPlainString(),cyclePaid.setScale(2).toPlainString(),
            valid == 0 ? null : ConsumptionCalculator.divide(BigDecimal.valueOf(distance),cycleLiters,2),
            valid == 0 ? null : ConsumptionCalculator.divide(cyclePaid,BigDecimal.valueOf(distance),4),reason,
            monthly,byFuel,List.copyOf(prices),cycles);
    }

    private static final class Totals {
        long count;
        BigDecimal paid=BigDecimal.ZERO,liters=BigDecimal.ZERO;
        void add(FuelHistory entry) { count++; paid=paid.add(entry.paidTotal()); liters=liters.add(entry.liters()); }
        String paid() { return paid.setScale(2).toPlainString(); }
        String volume() { return liters.setScale(3).toPlainString(); }
    }

    public Summary summary(UUID vehicleId, LocalDate from, LocalDate to, String timezone) {
        var records=history.read(vehicleId);
        var period=Period.of(from,to,timezone);
        var result=calculator.calculate(records);
        var purchases=records.stream().filter(e -> !e.deleted() && period.contains(e.occurredAt())).toList();
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
