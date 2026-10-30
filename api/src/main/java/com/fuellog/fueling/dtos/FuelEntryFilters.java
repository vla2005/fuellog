package com.fuellog.fueling.dtos;

import com.fuellog.platform.validation.DomainValues;
import java.math.BigDecimal;

public record FuelEntryFilters(BigDecimal minTotalPaid, BigDecimal maxTotalPaid,
    BigDecimal minLiters, BigDecimal maxLiters, BigDecimal minPricePerLiter, BigDecimal maxPricePerLiter) {
    public static FuelEntryFilters parse(String minTotalPaid, String maxTotalPaid, String minLiters,
        String maxLiters, String minPricePerLiter, String maxPricePerLiter) {
        var filters=new FuelEntryFilters(decimal(minTotalPaid,"minTotalPaid",12,2),decimal(maxTotalPaid,"maxTotalPaid",12,2),
            decimal(minLiters,"minLiters",10,3),decimal(maxLiters,"maxLiters",10,3),
            decimal(minPricePerLiter,"minPricePerLiter",10,4),decimal(maxPricePerLiter,"maxPricePerLiter",10,4));
        range(filters.minTotalPaid,filters.maxTotalPaid,"maxTotalPaid");
        range(filters.minLiters,filters.maxLiters,"maxLiters");
        range(filters.minPricePerLiter,filters.maxPricePerLiter,"maxPricePerLiter");
        return filters;
    }

    private static BigDecimal decimal(String value, String field, int precision, int scale) {
        if (value == null) return null;
        if (value.length() > 64 || !value.matches("[0-9]+(?:\\.[0-9]+)?"))
            throw DomainValues.invalid(field,"Informe decimal n\u00e3o negativo com ponto.");
        var number=new BigDecimal(value);
        if (number.scale() > scale || number.compareTo(BigDecimal.TEN.pow(precision-scale)) >= 0)
            throw DomainValues.invalid(field,"Valor deve respeitar precis\u00e3o "+precision+" e escala "+scale+".");
        return number;
    }

    private static void range(BigDecimal min, BigDecimal max, String field) {
        if (min != null && max != null && min.compareTo(max) > 0)
            throw DomainValues.invalid(field,"M\u00e1ximo deve ser maior ou igual ao m\u00ednimo.");
    }
}
