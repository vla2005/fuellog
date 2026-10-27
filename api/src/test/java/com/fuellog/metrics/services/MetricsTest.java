package com.fuellog.metrics.services;

import com.fuellog.fueling.enums.TankState;
import com.fuellog.fueling.models.FuelHistory;
import com.fuellog.fueling.services.FuelHistoryService;
import com.fuellog.platform.exceptions.ApiException;
import com.fuellog.vehicles.enums.FuelType;

import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import static com.fuellog.metrics.enums.UnavailableReason.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MetricsTest {
    private final UUID vehicleId=UUID.randomUUID();
    private final ConsumptionCalculator calculator=new ConsumptionCalculator();
    private FuelHistory entry(int day, long km, String liters, TankState tank, boolean gap, FuelType fuel, String paid) {
        return new FuelHistory(UUID.randomUUID(),Instant.parse("2026-10-%02dT12:00:00Z".formatted(day)),km,fuel,
            new BigDecimal(liters),new BigDecimal(paid),tank,gap);
    }
    private FuelHistory full(int day, long km, String liters) {
        return entry(day,km,liters,TankState.FULL,false,FuelType.GASOLINE_REGULAR,new BigDecimal(liters).multiply(new BigDecimal("6")).toPlainString());
    }
    private MetricsService service(List<FuelHistory> records) {
        var history=mock(FuelHistoryService.class);
        when(history.read(vehicleId)).thenReturn(records);
        return new MetricsService(history);
    }
    @Test void partialAndUnknownVolumesAndActualPaymentsBelongToClosingCycle() {
        var a=full(1,10000,"40");
        var p=entry(2,10200,"15",TankState.PARTIAL,false,FuelType.ETHANOL,"70");
        var b=entry(3,10500,"30",TankState.FULL,false,FuelType.GASOLINE_REGULAR,"170");
        var c=calculator.calculate(List.of(a,p,b)).cycles().getFirst();
        assertEquals("45.000",c.liters()); assertEquals("11.11",c.consumptionKmPerLiter());
        assertEquals("240.00",c.paidTotal()); assertEquals("0.4800",c.replacementCostPerKm());
        assertTrue(c.mixed()); assertEquals(List.of(FuelType.GASOLINE_REGULAR,FuelType.ETHANOL),c.fuelTypes());
        var unknown=new FuelHistory(p.id(),p.occurredAt(),p.odometerKm(),p.fuelType(),p.liters(),p.paidTotal(),TankState.UNKNOWN,false);
        assertEquals(c,calculator.calculate(List.of(a,unknown,b)).cycles().getFirst());
    }
    @Test void globalConsumptionUsesTotalDistanceOverTotalLiters() {
        var s=service(List.of(full(1,1000,"40"),full(2,1100,"10"),full(3,2000,"60")))
            .summary(vehicleId,null,null,"America/Sao_Paulo");
        assertEquals("14.29",s.periodConsumptionKmPerLiter()); assertEquals(1000,s.cycleDistanceKm());
        assertEquals("70.000",s.cycleLiters()); assertEquals(2,s.validCycleCount());
    }
    @Test void partialGapInvalidatesUntilNextFullWhichReopensBaseline() {
        var gap=entry(2,10200,"15",TankState.PARTIAL,true,FuelType.GASOLINE_REGULAR,"90");
        var cycles=calculator.calculate(List.of(full(1,10000,"40"),gap,full(3,10500,"30"),full(4,10600,"10"))).cycles();
        assertEquals(HISTORY_GAP,cycles.getFirst().unavailableReason()); assertNull(cycles.getFirst().consumptionKmPerLiter());
        assertEquals("10.00",cycles.getLast().consumptionKmPerLiter());
    }
    @Test void fullWithGapCanStartNextValidCycle() {
        var gap=entry(2,10500,"30",TankState.FULL,true,FuelType.GASOLINE_REGULAR,"180");
        var cycles=calculator.calculate(List.of(full(1,10000,"40"),gap,full(3,10600,"10"))).cycles();
        assertEquals(HISTORY_GAP,cycles.getFirst().unavailableReason());
        assertEquals(gap.id(),cycles.getLast().startEntryId()); assertEquals("10.00",cycles.getLast().consumptionKmPerLiter());
    }
    @Test void zeroDistanceNeverDividesAndNextCycleCanRecover() {
        var result=calculator.calculate(List.of(full(1,1000,"40"),full(2,1000,"10")));
        var cycle=result.cycles().getFirst();
        assertEquals(ZERO_DISTANCE,cycle.unavailableReason()); assertNull(cycle.consumptionKmPerLiter());
        assertNull(cycle.replacementCostPerKm()); assertEquals(ZERO_DISTANCE,result.currentUnavailableReason());
    }
    @Test void noBaselineAndOpenCycleExplainMissingConsumption() {
        assertEquals(NEEDS_FULL_TANK_BASELINE,calculator.calculate(List.of()).currentUnavailableReason());
        var partial=entry(2,1200,"10",TankState.PARTIAL,false,FuelType.GASOLINE_REGULAR,"60");
        assertEquals(NEEDS_FULL_TANK_BASELINE,calculator.calculate(List.of(partial)).currentUnavailableReason());
        assertEquals(OPEN_CYCLE,calculator.calculate(List.of(full(1,1000,"40"))).currentUnavailableReason());
        var summary=service(List.of(full(1,1000,"40"),partial)).summary(vehicleId,null,null,"America/Sao_Paulo");
        assertNull(summary.periodConsumptionKmPerLiter()); assertEquals(OPEN_CYCLE,summary.periodUnavailableReason());
        assertNull(summary.lastValidCycle()); assertEquals(OPEN_CYCLE,summary.lastConsumptionUnavailableReason());
    }
    @Test void purchasesUseActualAdjustedPaymentAndWeightedPrice() {
        var s=service(List.of(entry(1,1000,"40",TankState.PARTIAL,false,FuelType.GASOLINE_REGULAR,"230")))
            .summary(vehicleId,null,null,"America/Sao_Paulo");
        assertEquals("230.00",s.paidTotal()); assertEquals("5.7500",s.weightedPaidPrice()); assertEquals(1,s.purchaseCount());
        var weighted=service(List.of(entry(1,1000,"10",TankState.PARTIAL,false,FuelType.GASOLINE_REGULAR,"50"),
            entry(2,1100,"40",TankState.PARTIAL,false,FuelType.GASOLINE_REGULAR,"240")))
            .summary(vehicleId,null,null,"America/Sao_Paulo");
        assertEquals("5.8000",weighted.weightedPaidPrice());
    }
    @Test void periodSelectsClosingCyclesWithoutFilteringTheirSourcePurchases() {
        var records=List.of(full(1,10000,"40"),entry(2,10200,"15",TankState.PARTIAL,false,FuelType.GASOLINE_REGULAR,"90"),full(3,10500,"30"));
        var metrics=service(records);
        var s=metrics.summary(vehicleId,LocalDate.of(2026,10,3),LocalDate.of(2026,10,3),"America/Sao_Paulo");
        assertEquals(1,s.purchaseCount()); assertEquals("30.000",s.purchasedLiters()); assertEquals("180.00",s.paidTotal());
        assertEquals("45.000",s.cycleLiters()); assertEquals("11.11",s.periodConsumptionKmPerLiter());
        assertEquals(records.getFirst().occurredAt(),s.lastValidCycle().startedAt());
        var outside=metrics.summary(vehicleId,LocalDate.of(2026,10,4),LocalDate.of(2026,10,4),"America/Sao_Paulo");
        assertEquals(s.lastValidCycle(),outside.lastValidCycle()); assertNull(outside.periodConsumptionKmPerLiter());
        assertNull(outside.weightedPaidPrice()); assertEquals(0,outside.purchaseCount());
        assertEquals(NO_VALID_CYCLE_IN_PERIOD,outside.periodUnavailableReason()); assertNull(outside.lastConsumptionUnavailableReason());
        assertEquals(1,metrics.cycles(vehicleId,LocalDate.of(2026,10,3),LocalDate.of(2026,10,3),"America/Sao_Paulo").items().size());
    }
    @Test void inclusiveCivilDatesRespectTimezoneAtMidnight() {
        var base=full(1,1000,"40");
        var end=new FuelHistory(UUID.randomUUID(),Instant.parse("2026-11-01T02:59:59Z"),1100,FuelType.GASOLINE_REGULAR,
            new BigDecimal("10"),new BigDecimal("60"),TankState.FULL,false);
        var next=new FuelHistory(UUID.randomUUID(),Instant.parse("2026-11-01T03:00:00Z"),1200,FuelType.GASOLINE_REGULAR,
            new BigDecimal("10"),new BigDecimal("60"),TankState.FULL,false);
        var s=service(List.of(base,end,next)).summary(vehicleId,LocalDate.of(2026,10,31),LocalDate.of(2026,10,31),"America/Sao_Paulo");
        assertEquals(1,s.purchaseCount()); assertEquals(1,s.validCycleCount()); assertEquals(next.id(),s.lastValidCycle().endEntryId());
    }
    @Test void rejectsInvalidDatesAndTimezoneAndPropagatesOwnershipFailure() {
        var metrics=service(List.of());
        assertThrows(ApiException.class,()->metrics.summary(vehicleId,LocalDate.of(2026,10,2),LocalDate.of(2026,10,1),"America/Sao_Paulo"));
        assertThrows(ApiException.class,()->metrics.cycles(vehicleId,null,null,"-03:00"));
        assertThrows(ApiException.class,()->metrics.summary(vehicleId,null,LocalDate.MAX,"America/Sao_Paulo"));
        var history=mock(FuelHistoryService.class);
        when(history.read(vehicleId)).thenThrow(new ApiException(404,"RESOURCE_NOT_FOUND","Recurso não encontrado."));
        assertEquals(404,assertThrows(ApiException.class,()->new MetricsService(history).summary(vehicleId,null,null,"America/Sao_Paulo")).status());
    }
}
