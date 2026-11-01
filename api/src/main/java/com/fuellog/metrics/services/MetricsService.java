package com.fuellog.metrics.services;

import com.fuellog.fueling.models.FuelHistory;
import com.fuellog.fueling.services.FuelHistoryService;
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
    public MetricsService(FuelHistoryService history) { this.history=history; }

    public Dashboard dashboard(UUID vehicleId, LocalDate from, LocalDate to, String timezone, FuelType fuelType) {
        var records=history.read(vehicleId);
        var period=Period.of(from,to,timezone);
        var zone=DomainValues.zone(timezone);
        var months=new TreeMap<YearMonth,Totals>();
        var fuels=new EnumMap<FuelType,Totals>(FuelType.class);
        var prices=new ArrayList<Price>();
        var total=new Totals();
        BigDecimal declaredCost=BigDecimal.ZERO, declaredLiters=BigDecimal.ZERO;
        for (FuelHistory entry:records) {
            if (!period.contains(entry.occurredAt()) || fuelType != null && entry.fuelType() != fuelType) continue;
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
        var monthly=months.entrySet().stream().map(e->{
            var month=e.getKey(); var values=e.getValue();
            LocalDate start=month.atDay(1), end=month.atEndOfMonth();
            return new MonthlyTotal(month.toString(),from != null && from.isAfter(start) ? from : start,
                to != null && to.isBefore(end) ? to : end,values.count,values.paid(),values.volume());
        }).toList();
        var byFuel=fuels.entrySet().stream().map(e->new FuelSpending(e.getKey(),e.getValue().count,e.getValue().paid(),e.getValue().volume(),
            divide(e.getValue().paid.multiply(BigDecimal.valueOf(100)),total.paid,4))).toList();
        return new Dashboard(vehicleId,from,to,timezone,fuelType,total.count,total.paid(),total.volume(),
            divide(declaredCost,declaredLiters,4),monthly,byFuel,List.copyOf(prices));
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
        var purchases=records.stream().filter(e -> period.contains(e.occurredAt())).toList();
        BigDecimal paid=BigDecimal.ZERO, liters=BigDecimal.ZERO;
        for (FuelHistory entry:purchases) { paid=paid.add(entry.paidTotal()); liters=liters.add(entry.liters()); }
        return new Summary(vehicleId,from,to,timezone,purchases.size(),paid.setScale(2).toPlainString(),liters.setScale(3).toPlainString(),
            divide(paid,liters,4));
    }

    private static String divide(BigDecimal numerator, BigDecimal denominator, int scale) {
        return denominator.signum() == 0 ? null : numerator.divide(denominator,scale,java.math.RoundingMode.HALF_UP).toPlainString();
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
