package com.fuellog.vehicles;

import com.fuellog.fueling.DomainValues;
import com.fuellog.fueling.StrictDecimalString;
import tools.jackson.databind.annotation.JsonDeserialize;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

public final class VehicleDtos {
    private VehicleDtos() {}
    public record Create(String nickname, String brand, String model, Integer modelYear, String plate,
        @JsonDeserialize(using=StrictDecimalString.class) String tankCapacityLiters, Set<FuelType> allowedFuels, Long currentOdometerKm) {
        Create normalized() {
            if (currentOdometerKm != null && currentOdometerKm < 0) throw DomainValues.invalid("currentOdometerKm", "Informe uma quilometragem inteira n\u00e3o negativa.");
            if (modelYear != null && (modelYear < 1886 || modelYear > 2200)) throw DomainValues.invalid("modelYear", "Ano fora da faixa 1886\u20132200.");
            if (allowedFuels == null || allowedFuels.isEmpty() || allowedFuels.stream().anyMatch(java.util.Objects::isNull)) throw DomainValues.invalid("allowedFuels", "Selecione combust\u00edveis v\u00e1lidos.");
            var capacity=DomainValues.decimal(tankCapacityLiters,"tankCapacityLiters",8,3,false);
            return new Create(DomainValues.text(nickname,"nickname",60,true),DomainValues.text(brand,"brand",80,false),
                DomainValues.text(model,"model",80,false),modelYear,DomainValues.text(plate,"plate",16,false),
                capacity == null ? null : capacity.toPlainString(),Set.copyOf(allowedFuels),currentOdometerKm);
        }
    }
    public record View(UUID id, String nickname, String brand, String model, Integer modelYear, String plate,
        String tankCapacityLiters, Set<FuelType> allowedFuels, Instant archivedAt, Long version, Long currentOdometerKm) {}
}
