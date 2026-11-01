package com.fuellog.fueling.dtos;

import com.fuellog.platform.serialization.StrictCoordinate;
import com.fuellog.platform.serialization.StrictDecimalString;
import com.fuellog.platform.serialization.StrictOdometer;
import com.fuellog.vehicles.enums.FuelType;
import com.fuellog.vikash.dtos.ViKashDtos;

import tools.jackson.databind.annotation.JsonDeserialize;
import java.time.*;
import java.math.BigDecimal;
import java.util.*;

public final class FuelEntryDtos {
    private FuelEntryDtos() {}
    public record Create(UUID id, OffsetDateTime occurredAt, String timezone, @JsonDeserialize(using=StrictOdometer.class) Long odometerKm, FuelType fuelType,
        @JsonDeserialize(using=StrictDecimalString.class) String liters,
        @JsonDeserialize(using=StrictDecimalString.class) String unitPrice,
        @JsonDeserialize(using=StrictDecimalString.class) String paidTotal,
        String adjustmentReason,
        @JsonDeserialize(using=StrictCoordinate.class) BigDecimal latitude,
        @JsonDeserialize(using=StrictCoordinate.class) BigDecimal longitude, ViKashDtos.Selection vikash) {
        public Create(UUID id,OffsetDateTime occurredAt,String timezone,Long odometerKm,FuelType fuelType,String liters,String unitPrice,String paidTotal,String adjustmentReason,BigDecimal latitude,BigDecimal longitude) {
            this(id,occurredAt,timezone,odometerKm,fuelType,liters,unitPrice,paidTotal,adjustmentReason,latitude,longitude,null);
        }
    }
    public record Update(OffsetDateTime occurredAt, String timezone, @JsonDeserialize(using=StrictOdometer.class) Long odometerKm, FuelType fuelType,
        @JsonDeserialize(using=StrictDecimalString.class) String liters,
        @JsonDeserialize(using=StrictDecimalString.class) String unitPrice,
        @JsonDeserialize(using=StrictDecimalString.class) String paidTotal,
        String adjustmentReason,
        @JsonDeserialize(using=StrictCoordinate.class) BigDecimal latitude,
        @JsonDeserialize(using=StrictCoordinate.class) BigDecimal longitude, ViKashDtos.Selection vikash) {
        public Update(OffsetDateTime occurredAt,String timezone,Long odometerKm,FuelType fuelType,String liters,String unitPrice,String paidTotal,String adjustmentReason,BigDecimal latitude,BigDecimal longitude) {
            this(occurredAt,timezone,odometerKm,fuelType,liters,unitPrice,paidTotal,adjustmentReason,latitude,longitude,null);
        }
    }
    public record View(UUID id, UUID vehicleId, Instant occurredAt, String timezone, long odometerKm, FuelType fuelType,
        String liters, String unitPrice, String paidTotal, String referenceTotal, String adjustmentAmount,
        String adjustmentReason,
        Long version, boolean idempotentReplay, BigDecimal latitude, BigDecimal longitude, ViKashDtos.EntryStatus vikash) {}
    public record Summary(String paidTotal, String purchasedLiters) {}
    public record MonthlyCount(String month, long purchaseCount) {}
    public record Page(List<View> items, int page, int size, long totalElements, int totalPages,
        Summary summary, List<MonthlyCount> monthlyCounts) {}
}
