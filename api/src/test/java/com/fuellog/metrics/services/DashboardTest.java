package com.fuellog.metrics.services;

import com.fuellog.fueling.models.FuelHistory;
import com.fuellog.fueling.services.FuelHistoryService;
import com.fuellog.platform.exceptions.ApiException;
import com.fuellog.vehicles.enums.FuelType;
import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class DashboardTest {
    private final UUID vehicle=UUID.randomUUID();
    private FuelHistory entry(String at,long km,String liters,String paid,String price,FuelType fuel) {
        return new FuelHistory(UUID.randomUUID(),Instant.parse(at),km,fuel,new BigDecimal(liters),new BigDecimal(paid),new BigDecimal(price));
    }
    private MetricsService service(List<FuelHistory> records) {
        var history=mock(FuelHistoryService.class); when(history.read(vehicle)).thenReturn(records); return new MetricsService(history);
    }
    @Test void aggregatesEntireHistoryAndUsesCivilMonthAndDeclaredPrices() {
        var records=new ArrayList<FuelHistory>();
        for(int i=0;i<65;i++) records.add(entry("2026-10-01T12:00:00Z",100,"1.001","4.02","4.0000",FuelType.ETHANOL));
        records.add(entry("2026-11-01T02:59:59Z",200,"2.000","10.00","6.0000",FuelType.GASOLINE_REGULAR));
        records.add(entry("2026-11-01T03:00:00Z",300,"20","120","6",FuelType.GASOLINE_REGULAR));
        var data=service(records).dashboard(vehicle,LocalDate.of(2026,10,1),LocalDate.of(2026,10,31),"America/Sao_Paulo",null);
        assertEquals(66,data.purchaseCount()); assertEquals("271.30",data.paidTotal()); assertEquals("67.065",data.purchasedLiters());
        assertEquals("4.0596",data.weightedUnitPrice()); assertEquals(66,data.prices().size());
        assertEquals("6.0000",data.prices().getLast().unitPrice()); assertEquals("2026-10",data.months().getFirst().month());
        assertEquals("271.30",data.months().getFirst().paidTotal()); assertEquals(2,data.fuels().size());
        assertEquals("96.3140",data.fuels().stream().filter(f->f.fuelType()==FuelType.ETHANOL).findFirst().orElseThrow().percentage());
    }
    @Test void fuelFilterSelectsAllMatchingPurchases() {
        var records=List.of(
            entry("2026-09-30T12:00:00Z",1000,"40","240","6",FuelType.GASOLINE_REGULAR),
            entry("2026-10-01T12:00:00Z",1100,"10","40","4",FuelType.ETHANOL),
            entry("2026-10-02T12:00:00Z",1300,"20","120","6",FuelType.GASOLINE_REGULAR),
            entry("2026-10-03T12:00:00Z",1500,"10","40","4",FuelType.ETHANOL),
            entry("2026-10-04T12:00:00Z",1800,"30","150","5",FuelType.ETHANOL));
        var metrics=service(records);
        var all=metrics.dashboard(vehicle,LocalDate.of(2026,10,1),LocalDate.of(2026,10,31),"America/Sao_Paulo",null);
        assertEquals(4,all.purchaseCount());
        var pure=metrics.dashboard(vehicle,LocalDate.of(2026,10,1),LocalDate.of(2026,10,31),"America/Sao_Paulo",FuelType.ETHANOL);
        assertEquals("230.00",pure.paidTotal()); assertEquals(3,pure.purchaseCount());
    }
    @Test void emptyPeriodsHaveNoInventedMonthsOrPrices() {
        var records=List.of(
            entry("2026-09-30T12:00:00Z",1000,"40","240","6",FuelType.ETHANOL),
            entry("2026-10-01T12:00:00Z",1100,"10","40","4",FuelType.ETHANOL),
            entry("2026-10-02T12:00:00Z",1300,"20","80","4",FuelType.ETHANOL));
        var metrics=service(records);
        var data=metrics.dashboard(vehicle,LocalDate.of(2026,10,1),LocalDate.of(2026,10,31),"America/Sao_Paulo",null);
        assertEquals(2,data.purchaseCount()); assertEquals("120.00",data.paidTotal());
        var empty=metrics.dashboard(vehicle,LocalDate.of(2025,1,1),LocalDate.of(2025,1,31),"UTC",null);
        assertTrue(empty.months().isEmpty()); assertTrue(empty.prices().isEmpty()); assertNull(empty.weightedUnitPrice());
        assertThrows(ApiException.class,()->metrics.dashboard(vehicle,LocalDate.of(2026,10,2),LocalDate.of(2026,10,1),"UTC",null));
        assertThrows(ApiException.class,()->metrics.dashboard(vehicle,null,null,"Not/AZone",null));
    }
}
