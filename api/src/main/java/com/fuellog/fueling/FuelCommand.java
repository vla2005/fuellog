package com.fuellog.fueling;

import com.fuellog.vehicles.FuelType;
import java.io.*;
import java.math.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.util.*;

record FuelCommand(UUID id, UUID vehicleId, Instant occurredAt, String timezone, long odometerKm,
    FuelType fuelType, BigDecimal liters, BigDecimal unitPrice, BigDecimal paidTotal, TankState tankState,
    boolean historyGapBefore, String adjustmentReason, String stationName, String notes) {
    static FuelCommand normalize(UUID vehicleId, FuelEntryDtos.Create input) {
        if (input.id() == null) throw DomainValues.invalid("id","UUID do cliente obrigat\u00f3rio.");
        if (input.occurredAt() == null) throw DomainValues.invalid("occurredAt","Data com offset obrigat\u00f3ria.");
        DomainValues.zone(input.timezone());
        if (input.odometerKm() == null || input.odometerKm() < 0) throw DomainValues.invalid("odometerKm","Informe inteiro n\u00e3o negativo.");
        if (input.fuelType() == null) throw DomainValues.invalid("fuelType","Combust\u00edvel obrigat\u00f3rio.");
        if (input.tankState() == null) throw DomainValues.invalid("tankState","Estado do tanque obrigat\u00f3rio.");
        if (input.historyGapBefore() == null) throw DomainValues.invalid("historyGapBefore","Continuidade obrigat\u00f3ria.");
        BigDecimal liters=DomainValues.decimal(input.liters(),"liters",10,3,true);
        BigDecimal price=DomainValues.decimal(input.unitPrice(),"unitPrice",10,4,true);
        BigDecimal paid=DomainValues.decimal(input.paidTotal(),"paidTotal",12,2,true);
        String reason=DomainValues.text(input.adjustmentReason(),"adjustmentReason",300,false);
        if (paid.subtract(reference(liters,price)).abs().compareTo(new BigDecimal("0.05")) > 0 && reason == null)
            throw DomainValues.invalid("adjustmentReason","Justifique ajuste superior a R$ 0,05.");
        return new FuelCommand(input.id(),vehicleId,input.occurredAt().toInstant(),input.timezone(),input.odometerKm(),
            input.fuelType(),liters,price,paid,input.tankState(),input.historyGapBefore(),reason,
            DomainValues.text(input.stationName(),"stationName",120,false),DomainValues.text(input.notes(),"notes",1000,false));
    }
    static BigDecimal reference(BigDecimal liters, BigDecimal price) { return liters.multiply(price).setScale(2,RoundingMode.HALF_UP); }
    String hash() {
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
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes.toByteArray()));
        } catch (IOException | NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
