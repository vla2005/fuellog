package com.fuellog.fueling.models;

import com.fuellog.fueling.dtos.FuelEntryDtos;
import com.fuellog.fueling.enums.TankState;
import com.fuellog.platform.validation.DomainValues;
import com.fuellog.vehicles.enums.FuelType;

import java.io.*;
import java.math.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.util.*;

public record FuelCommand(UUID id, UUID vehicleId, Instant occurredAt, String timezone, long odometerKm,
    FuelType fuelType, BigDecimal liters, BigDecimal unitPrice, BigDecimal paidTotal, TankState tankState,
    boolean historyGapBefore, String adjustmentReason, String stationName, String notes,
    BigDecimal latitude, BigDecimal longitude) {
    public static FuelCommand normalize(UUID vehicleId, UUID entryId, FuelEntryDtos.Update input) {
        return normalize(vehicleId,new FuelEntryDtos.Create(entryId,input.occurredAt(),input.timezone(),input.odometerKm(),
            input.fuelType(),input.liters(),input.unitPrice(),input.paidTotal(),input.tankState(),input.historyGapBefore(),
            input.adjustmentReason(),input.stationName(),input.notes(),input.latitude(),input.longitude()));
    }
    public static FuelCommand normalize(UUID vehicleId, FuelEntryDtos.Create input) {
        if (input.id() == null) throw DomainValues.invalid("id","UUID do cliente obrigat\u00f3rio.");
        if (input.occurredAt() == null) throw DomainValues.invalid("occurredAt","Data com offset obrigat\u00f3ria.");
        DomainValues.zone(input.timezone());
        if (input.odometerKm() == null || input.odometerKm() < 0) throw DomainValues.invalid("odometerKm","Informe inteiro n\u00e3o negativo.");
        if (input.fuelType() == null) throw DomainValues.invalid("fuelType","Combust\u00edvel obrigat\u00f3rio.");
        if ((input.latitude() == null) != (input.longitude() == null))
            throw DomainValues.invalid(input.latitude() == null ? "latitude" : "longitude","Informe ambas as coordenadas.");
        BigDecimal latitude=coordinate(input.latitude(),"latitude",90);
        BigDecimal longitude=coordinate(input.longitude(),"longitude",180);
        BigDecimal liters=DomainValues.decimal(input.liters(),"liters",10,3,true);
        BigDecimal price=DomainValues.decimal(input.unitPrice(),"unitPrice",10,4,true);
        BigDecimal paid=DomainValues.decimal(input.paidTotal(),"paidTotal",12,2,true);
        String reason=DomainValues.text(input.adjustmentReason(),"adjustmentReason",300,false);
        if (paid.subtract(reference(liters,price)).abs().compareTo(new BigDecimal("0.05")) > 0 && reason == null)
            throw DomainValues.invalid("adjustmentReason","Justifique ajuste superior a R$ 0,05.");
        return new FuelCommand(input.id(),vehicleId,input.occurredAt().toInstant(),input.timezone(),input.odometerKm(),
            input.fuelType(),liters,price,paid,input.tankState() == null ? TankState.UNKNOWN : input.tankState(),
            Boolean.TRUE.equals(input.historyGapBefore()),reason,
            DomainValues.text(input.stationName(),"stationName",120,false),DomainValues.text(input.notes(),"notes",1000,false),latitude,longitude);
    }
    private static BigDecimal coordinate(BigDecimal value, String field, int maximum) {
        if (value == null) return null;
        if (value.abs().compareTo(BigDecimal.valueOf(maximum)) > 0 || value.stripTrailingZeros().scale() > 7)
            throw DomainValues.invalid(field,"Coordenada fora do intervalo ou com mais de sete casas decimais.");
        return value.stripTrailingZeros();
    }
    public void requireLocation() {
        if (latitude == null) throw DomainValues.invalid("latitude","Localiza\u00e7\u00e3o obrigat\u00f3ria para novo abastecimento.");
    }
    static BigDecimal reference(BigDecimal liters, BigDecimal price) { return liters.multiply(price).setScale(2,RoundingMode.HALF_UP); }
    public String hash() {
        // Length prefixes prevent delimiter collisions; decimals and instants have canonical forms.
        try {
            var bytes=new ByteArrayOutputStream();
            var out=new DataOutputStream(bytes);
            Object[] values={id,vehicleId,occurredAt,timezone,odometerKm,fuelType,liters.stripTrailingZeros().toPlainString(),
                unitPrice.stripTrailingZeros().toPlainString(),paidTotal.stripTrailingZeros().toPlainString(),tankState,
                historyGapBefore,adjustmentReason,stationName,notes};
            for (Object value:values) {
                if(value == null) out.writeInt(-1);
                else { byte[] data=value.toString().getBytes(StandardCharsets.UTF_8); out.writeInt(data.length); out.write(data); }
            }
            // Preserve pre-GPS fingerprints so legitimate legacy retries still return their original entry.
            if (latitude != null) {
                for (BigDecimal coordinate:List.of(latitude,longitude)) {
                    byte[] data=coordinate.stripTrailingZeros().toPlainString().getBytes(StandardCharsets.UTF_8);
                    out.writeInt(data.length); out.write(data);
                }
            }
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes.toByteArray()));
        } catch (IOException | NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
