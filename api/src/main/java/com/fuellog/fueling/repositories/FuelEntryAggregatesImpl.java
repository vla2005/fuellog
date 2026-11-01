package com.fuellog.fueling.repositories;

import com.fuellog.fueling.models.FuelEntry;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.jpa.domain.Specification;

public class FuelEntryAggregatesImpl implements FuelEntryAggregates {
    private final EntityManager entityManager;
    public FuelEntryAggregatesImpl(EntityManager entityManager) { this.entityManager=entityManager; }

    @Override
    public List<MonthlyTotal> monthlyTotals(Specification<FuelEntry> filter, String timezone) {
        var builder=entityManager.getCriteriaBuilder();
        var query=builder.createTupleQuery();
        var root=query.from(FuelEntry.class);
        var localTime=builder.function("timezone",LocalDateTime.class,builder.literal(timezone),root.get("occurredAt"));
        var month=builder.function("to_char",String.class,localTime,builder.literal("YYYY-MM"));
        query.multiselect(month,builder.count(root),builder.sum(root.<BigDecimal>get("paidTotal")),
            builder.sum(root.<BigDecimal>get("liters")))
            .where(filter.toPredicate(root,query,builder)).groupBy(month).orderBy(builder.desc(month));
        return entityManager.createQuery(query).getResultList().stream()
            .map(row -> new MonthlyTotal(row.get(0,String.class),row.get(1,Long.class),
                row.get(2,BigDecimal.class),row.get(3,BigDecimal.class))).toList();
    }
}
