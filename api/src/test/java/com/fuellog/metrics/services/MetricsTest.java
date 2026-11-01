package com.fuellog.metrics.services;

import com.fuellog.fueling.models.FuelHistory;
import com.fuellog.fueling.services.FuelHistoryService;
import com.fuellog.vehicles.enums.FuelType;
import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MetricsTest {
    @Test void summaryIncludesEveryPurchaseAndWeightsActualPaymentByLiters() {
        UUID vehicle=UUID.randomUUID(); var history=mock(FuelHistoryService.class);
        when(history.read(vehicle)).thenReturn(List.of(
            new FuelHistory(UUID.randomUUID(),Instant.parse("2026-10-01T02:59:59Z"),100,FuelType.ETHANOL,new BigDecimal("50"),new BigDecimal("200"),new BigDecimal("4")),
            new FuelHistory(UUID.randomUUID(),Instant.parse("2026-10-01T03:00:00Z"),200,FuelType.ETHANOL,new BigDecimal("10"),new BigDecimal("39"),new BigDecimal("4")),
            new FuelHistory(UUID.randomUUID(),Instant.parse("2026-10-02T12:00:00Z"),300,FuelType.GASOLINE_REGULAR,new BigDecimal("30"),new BigDecimal("180"),new BigDecimal("6"))));
        var metrics=new MetricsService(history);
        var data=metrics.summary(vehicle,LocalDate.of(2026,10,1),LocalDate.of(2026,10,31),"America/Sao_Paulo");
        assertEquals(2,data.purchaseCount()); assertEquals("219.00",data.paidTotal());
        assertEquals("40.000",data.purchasedLiters()); assertEquals("5.4750",data.weightedPaidPrice());
        var empty=metrics.summary(vehicle,LocalDate.of(2025,1,1),LocalDate.of(2025,1,31),"UTC");
        assertEquals(0,empty.purchaseCount()); assertNull(empty.weightedPaidPrice());
    }
}
