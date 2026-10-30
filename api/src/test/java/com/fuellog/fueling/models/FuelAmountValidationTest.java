package com.fuellog.fueling.models;

import com.fuellog.fueling.dtos.FuelEntryDtos;
import com.fuellog.fueling.enums.TankState;
import com.fuellog.fueling.repositories.FuelEntryRepository;
import com.fuellog.fueling.services.FuelEntryService;
import com.fuellog.platform.exceptions.ApiException;
import com.fuellog.vehicles.enums.FuelType;
import com.fuellog.vehicles.models.Vehicle;
import com.fuellog.vehicles.services.VehicleService;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.util.ReflectionTestUtils.setField;

class FuelAmountValidationTest {
    private final UUID vehicleId=UUID.randomUUID(), entryId=UUID.randomUUID();
    private final Instant now=Instant.parse("2026-10-24T12:00:00Z");
    private FuelEntryDtos.Create input(String liters,String price,String paid,String reason) {
        return new FuelEntryDtos.Create(entryId,now.atOffset(ZoneOffset.UTC),"America/Sao_Paulo",1000L,
            FuelType.GASOLINE_REGULAR,liters,price,paid,TankState.FULL,false,reason,null,null,
            BigDecimal.ZERO,BigDecimal.ZERO);
    }
    private FuelCommand command(String liters,String price,String paid,String reason) {
        return FuelCommand.normalize(vehicleId,input(liters,price,paid,reason));
    }
    @Test void validatesExactQuotientAndCentRoundingIncludingHighPrices() {
        for (String[] values:List.of(new String[]{"33.333","6","200"},
                new String[]{"1.001","20","20.01"},new String[]{"10.123","6.1234","61.99"},
                new String[]{"0.001","999999.9999","500"},
                new String[]{"0.001","20","0.01"})) {
            assertDoesNotThrow(()->command(values[0],values[1],values[2],null).validateAmounts());
        }
        // A receipt volume can round to the paid cents without equalling the quotient to 3 places.
        assertDoesNotThrow(()->command("1.001","1","1",null).validateAmounts());
    }
    @Test void rejectsManipulationInsideOldFiveCentToleranceAndFakeDiscountSurcharge() {
        assertThrows(ApiException.class,()->command("1","6","6.01",null).validateAmounts());
        assertThrows(ApiException.class,()->command("1","6","6.01","Desconto").validateAmounts());
        assertThrows(ApiException.class,()->command("1","6","7","qualquer justificativa").validateAmounts());
        var discounted=command("40","6.1234","230","Desconto");
        discounted.validateAmounts();
        assertEquals(new BigDecimal("40"),discounted.liters());
        assertEquals(new BigDecimal("230"),discounted.paidTotal());
    }
    @Test void rejectsZeroScaleOverflowAndQuotientRoundedToZero() {
        for (String[] values:List.of(new String[]{"0","6","6"},new String[]{"1","0","6"},
                new String[]{"1","6","0"},new String[]{"1.0000","6","6"},
                new String[]{"1","6.00000","6"},new String[]{"1","6","6.000"},
                new String[]{"10000000","1","1"},new String[]{"1","1000000","1"},
                new String[]{"1","1","10000000000"},new String[]{"0.001","999999","0.01"})) {
            assertThrows(ApiException.class,()->command(values[0],values[1],values[2],null).validateAmounts());
        }
    }
    @Test void legacyReplayAndDateOnlyEditRemainButNewAmountsAreValidated() {
        var repository=mock(FuelEntryRepository.class);
        var vehicles=mock(VehicleService.class);
        var vehicle=mock(Vehicle.class);
        when(vehicles.lockOwned(vehicleId)).thenReturn(vehicle);
        when(vehicle.allowedFuels()).thenReturn(Set.of(FuelType.GASOLINE_REGULAR));
        when(repository.saveAndFlush(any())).thenAnswer(i->i.getArgument(0));
        var service=new FuelEntryService(repository,vehicles,Clock.fixed(now,ZoneOffset.UTC));
        var old=input("1","6","6.04",null);
        var legacy=new FuelEntry(FuelCommand.normalize(vehicleId,old),false);
        setField(legacy,"version",0L);
        when(repository.findById(entryId)).thenReturn(Optional.of(legacy));
        assertTrue(service.create(vehicleId,old).idempotentReplay());
        when(repository.findByIdAndVehicleId(entryId,vehicleId)).thenReturn(Optional.of(legacy));
        var dateOnly=new FuelEntryDtos.Update(now.minusSeconds(60).atOffset(ZoneOffset.UTC),old.timezone(),1000L,
            old.fuelType(),"1.000","6.0000","6.04",old.tankState(),false,null,null,null,null,null);
        assertEquals(now.minusSeconds(60),service.update(vehicleId,entryId,"\"0\"",dateOnly).occurredAt());
        var changed=new FuelEntryDtos.Update(old.occurredAt(),old.timezone(),1000L,old.fuelType(),
            "1","6","6.03",old.tankState(),false,null,null,null,null,null);
        assertEquals(422,assertThrows(ApiException.class,()->service.update(vehicleId,entryId,"\"0\"",changed)).status());
        when(repository.findById(entryId)).thenReturn(Optional.empty());
        assertEquals(422,assertThrows(ApiException.class,()->service.create(vehicleId,old)).status());
    }
}
