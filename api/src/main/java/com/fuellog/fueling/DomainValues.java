package com.fuellog.fueling;

import com.fuellog.platform.ApiException;
import java.math.BigDecimal;
import java.time.ZoneId;
import java.util.Map;

public final class DomainValues {
    private DomainValues() {}
    public static ApiException invalid(String field, String message) {
        return new ApiException(422, "VALIDATION_ERROR", message, Map.of(field, message));
    }
    public static String text(String value, String field, int maximum, boolean required) {
        String normalized = value == null ? null : value.strip();
        if (normalized != null && normalized.isEmpty()) normalized = null;
        if (required && normalized == null) throw invalid(field, "Campo obrigat\u00f3rio.");
        if (normalized != null && normalized.length() > maximum) throw invalid(field, "Texto excede o limite de " + maximum + ".");
        return normalized;
    }
    public static BigDecimal decimal(String value, String field, int precision, int scale, boolean required) {
        if (value == null && !required) return null;
        if (value == null || !value.matches("[0-9]+(?:\\.[0-9]+)?")) throw invalid(field, "Informe decimal positivo como string com ponto.");
        BigDecimal result = new BigDecimal(value);
        if (result.signum() <= 0 || result.scale() > scale || result.compareTo(BigDecimal.TEN.pow(precision - scale)) >= 0)
            throw invalid(field, "Valor positivo deve respeitar precis\u00e3o " + precision + " e escala " + scale + ".");
        return result;
    }
    public static ZoneId zone(String value) {
        if (value == null || value.length() > 64 || !ZoneId.getAvailableZoneIds().contains(value))
            throw invalid("timezone", "Informe fuso IANA v\u00e1lido.");
        return ZoneId.of(value);
    }
}
