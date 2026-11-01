package com.fuellog.fueling.repositories;

import com.fuellog.fueling.models.FuelEntry;
import java.math.BigDecimal;
import java.util.List;
import org.springframework.data.jpa.domain.Specification;

public interface FuelEntryAggregates {
    record MonthlyTotal(String month, long purchaseCount, BigDecimal paidTotal, BigDecimal purchasedLiters) {}
    List<MonthlyTotal> monthlyTotals(Specification<FuelEntry> filter, String timezone);
}
