package com.fuellog.fueling;

import com.fuellog.platform.ApiException;
import com.fuellog.vehicles.*;
import org.junit.jupiter.api.*;
import tools.jackson.databind.json.JsonMapper;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class FuelEntryEditingTest {
    private final UUID vehicleId=UUID.randomUUID(), entryId=UUID.randomUUID();
    private final Instant now=Instant.parse("2026-10-24T12:00:00Z");
    private final FuelEntryRepository repository=mock(FuelEntryRepository.class);
    private final VehicleService vehicles=mock(VehicleService.class);
    private final Vehicle vehicle=mock(Vehicle.class);
    private final FuelEntryService service=new FuelEntryService(repository,vehicles,Clock.fixed(now,ZoneOffset.UTC));
    private FuelEntry entry;

    @BeforeEach void setup() {
        var create=new FuelEntryDtos.Create(entryId,now.atOffset(ZoneOffset.UTC),"America/Sao_Paulo",1000L,
            FuelType.GASOLINE_REGULAR,"10.123","6.1234","61.99",TankState.FULL,false,null,null,null,
            new BigDecimal("-23.55052"),new BigDecimal("-46.633308"));
        entry=new FuelEntry(FuelCommand.normalize(vehicleId,create),false); entry.version=2L;
        when(vehicles.lockOwned(vehicleId)).thenReturn(vehicle);
        when(vehicle.allowedFuels()).thenReturn(Set.of(FuelType.ETHANOL));
        when(repository.findByIdAndVehicleId(entryId,vehicleId)).thenReturn(Optional.of(entry));
        when(repository.saveAndFlush(any())).thenAnswer(i->i.getArgument(0));
    }

    private FuelEntryDtos.Update input(FuelType fuel, BigDecimal latitude, BigDecimal longitude) {
        return new FuelEntryDtos.Update(now.atOffset(ZoneOffset.UTC),"America/Sao_Paulo",1000L,fuel,
            "10.123","6.1234","60.00",TankState.FULL,false,"desconto"," Posto ","editado",latitude,longitude);
    }

    @Test void preservesIdentityCreationHashAndHistoricalFuelWithoutRecapturingGps() {
        String hash=entry.createRequestHash;
        when(vehicle.archivedAt()).thenReturn(now);
        var view=service.update(vehicleId,entryId,"\"2\"",input(FuelType.GASOLINE_REGULAR,null,null));
        assertEquals(entryId,view.id()); assertEquals(vehicleId,view.vehicleId());
        assertEquals(hash,entry.createRequestHash); assertEquals("60.00",view.paidTotal());
        assertEquals("61.99",view.referenceTotal()); assertEquals("-1.99",view.adjustmentAmount());
        assertEquals(new BigDecimal("-23.55052"),view.latitude());
        assertEquals("Posto",view.stationName()); assertFalse(view.idempotentReplay());
        verify(vehicle,never()).consumePendingGap();
    }

    @Test void validatesChangedFuelAndAllowsAnAllowedReplacement() {
        assertEquals(422,assertThrows(ApiException.class,()->service.update(vehicleId,entryId,"\"2\"",
            input(FuelType.DIESEL_S10,null,null))).status());
        assertEquals(FuelType.GASOLINE_REGULAR,entry.fuelType);
        assertEquals(FuelType.ETHANOL,service.update(vehicleId,entryId,"\"2\"",input(FuelType.ETHANOL,null,null)).fuelType());
    }

    @Test void preservesLegacyNullLocationAndValidatesEverySuppliedPair() {
        entry.latitude=null; entry.longitude=null;
        assertNull(service.update(vehicleId,entryId,"\"2\"",input(FuelType.GASOLINE_REGULAR,null,null)).latitude());
        for (BigDecimal latitude:List.of(new BigDecimal("90.0000001"),new BigDecimal("0.00000001")))
            assertEquals(422,assertThrows(ApiException.class,()->service.update(vehicleId,entryId,"\"2\"",
                input(FuelType.GASOLINE_REGULAR,latitude,BigDecimal.ZERO))).status());
        assertEquals(422,assertThrows(ApiException.class,()->service.update(vehicleId,entryId,"\"2\"",
            input(FuelType.GASOLINE_REGULAR,null,BigDecimal.ZERO))).status());
        assertEquals(BigDecimal.ZERO,service.update(vehicleId,entryId,"\"2\"",
            input(FuelType.GASOLINE_REGULAR,BigDecimal.ZERO,BigDecimal.ZERO)).latitude());
    }

    @Test void versionPreconditionsRejectMalformedAndStaleTagsBeforeMutation() {
        assertEquals(428,assertThrows(ApiException.class,()->service.update(vehicleId,entryId,null,input(FuelType.GASOLINE_REGULAR,null,null))).status());
        for (String tag:List.of("", "2", "W/\"2\"", "*", "\"-1\"", "\"02\"", "\"2\",\"3\"", "\"9223372036854775808\""))
            assertEquals(400,assertThrows(ApiException.class,()->service.update(vehicleId,entryId,tag,input(FuelType.GASOLINE_REGULAR,null,null))).status(),tag);
        assertEquals(412,assertThrows(ApiException.class,()->service.update(vehicleId,entryId,"\"1\"",input(FuelType.GASOLINE_REGULAR,null,null))).status());
        assertEquals("61.99",entry.paidTotal.toPlainString()); verify(repository,never()).saveAndFlush(any());
    }

    @Test void absentOrMismatchedEntryRemains404EvenWithoutVersion() {
        when(repository.findByIdAndVehicleId(entryId,vehicleId)).thenReturn(Optional.empty());
        assertEquals(404,assertThrows(ApiException.class,()->service.update(vehicleId,entryId,null,input(FuelType.GASOLINE_REGULAR,null,null))).status());
    }

    @Test void unexpectedOptimisticRaceIs412() {
        when(repository.saveAndFlush(any())).thenThrow(new org.springframework.orm.ObjectOptimisticLockingFailureException(FuelEntry.class,entryId));
        assertEquals(412,assertThrows(ApiException.class,()->service.update(vehicleId,entryId,"\"2\"",input(FuelType.GASOLINE_REGULAR,null,null))).status());
    }

    @Test void updateDeserializerKeepsStrictNumericTypes() {
        var mapper=JsonMapper.builder().build();
        for (String json:List.of("{\"liters\":1}","{\"unitPrice\":6}","{\"paidTotal\":6}",
                "{\"odometerKm\":1.1}","{\"odometerKm\":\"1\"}","{\"latitude\":\"0\"}"))
            assertThrows(Exception.class,()->mapper.readValue(json,FuelEntryDtos.Update.class));
    }
}
