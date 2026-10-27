package com.fuellog.fueling.models;

import com.fuellog.fueling.dtos.FuelEntryDtos;
import com.fuellog.fueling.enums.TankState;
import com.fuellog.fueling.repositories.FuelEntryRepository;
import com.fuellog.fueling.services.FuelEntryService;
import com.fuellog.platform.exceptions.ApiException;
import com.fuellog.platform.validation.DomainValues;
import com.fuellog.vehicles.dtos.VehicleDtos;
import com.fuellog.vehicles.enums.FuelType;
import com.fuellog.vehicles.models.Vehicle;
import com.fuellog.vehicles.services.VehicleService;

import static org.springframework.test.util.ReflectionTestUtils.*;
import org.junit.jupiter.api.*;
import org.springframework.data.domain.*;
import tools.jackson.databind.json.JsonMapper;
import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class FuelDomainTest {
    private final UUID vehicleId=UUID.randomUUID();
    private final UUID entryId=UUID.randomUUID();
    private final Instant now=Instant.parse("2026-10-24T12:00:00Z");
    private FuelEntryDtos.Create command(String liters,String price,String paid,String reason) {
        return new FuelEntryDtos.Create(entryId,now.atOffset(ZoneOffset.UTC),"America/Sao_Paulo",1000L,
            FuelType.GASOLINE_REGULAR,liters,price,paid,TankState.PARTIAL,false,reason," Posto ",null,new BigDecimal("-23.5505200"),new BigDecimal("-46.6333080"));
    }
    @Test void keepsActualPaymentAndRequiresAdjustmentReason() {
        var error=assertThrows(ApiException.class,()->FuelCommand.normalize(vehicleId,command("40","6","230",null)));
        assertEquals(422,error.status());
        var c=FuelCommand.normalize(vehicleId,command("40","6","230"," desconto "));
        var view=new FuelEntry(c,false).view(false);
        assertEquals("230",view.paidTotal());
        assertEquals("240.00",view.referenceTotal());
        assertEquals("-10.00",view.adjustmentAmount());
        assertEquals("desconto",view.adjustmentReason());
    }
    @Test void adjustmentToleranceAndHalfUpAreExact() {
        assertDoesNotThrow(()->FuelCommand.normalize(vehicleId,command("1","1.005","1.06",null)));
        assertThrows(ApiException.class,()->FuelCommand.normalize(vehicleId,command("1","1.005","1.07",null)));
        assertEquals(new BigDecimal("1.01"),FuelCommand.reference(new BigDecimal("1"),new BigDecimal("1.005")));
    }
    @Test void rejectsScaleEvenWhenTrailingDigitIsZeroAndRejectsOverflow() {
        assertThrows(ApiException.class,()->FuelCommand.normalize(vehicleId,command("1.0000","6","6",null)));
        assertThrows(ApiException.class,()->FuelCommand.normalize(vehicleId,command("1","6.00000","6",null)));
        assertThrows(ApiException.class,()->FuelCommand.normalize(vehicleId,command("1","6","6.000",null)));
        assertThrows(ApiException.class,()->DomainValues.decimal("10000000","liters",10,3,true));
        assertThrows(ApiException.class,()->DomainValues.decimal("0","liters",10,3,true));
        assertThrows(ApiException.class,()->DomainValues.decimal("1e2","liters",10,3,true));
    }
    @Test void hashNormalizesDecimalsTextAndOffsetButDetectsChangedCommand() {
        var a=FuelCommand.normalize(vehicleId,command("40.000","6.0000","230.00"," desconto "));
        var b=FuelCommand.normalize(vehicleId,command("40","6","230","desconto"));
        assertEquals(a.hash(),b.hash());
        assertNotEquals(a.hash(),FuelCommand.normalize(vehicleId,command("40","6","231","desconto")).hash());
        var offset=new FuelEntryDtos.Create(entryId,now.atOffset(ZoneOffset.ofHours(-3)),"America/Sao_Paulo",1000L,
            FuelType.GASOLINE_REGULAR,"40","6","230",TankState.PARTIAL,false,"desconto","Posto",null,new BigDecimal("-23.55052"),new BigDecimal("-46.633308"));
        assertEquals(a.hash(),FuelCommand.normalize(vehicleId,offset).hash());
    }
    @Test void jacksonRejectsNumericDecimalTokensForBothRequests() {
        var mapper=JsonMapper.builder().build();
        assertThrows(Exception.class,()->mapper.readValue("{\"liters\":35.5}",FuelEntryDtos.Create.class));
        assertThrows(Exception.class,()->mapper.readValue("{\"unitPrice\":6}",FuelEntryDtos.Create.class));
        assertThrows(Exception.class,()->mapper.readValue("{\"paidTotal\":210}",FuelEntryDtos.Create.class));
        assertThrows(Exception.class,()->mapper.readValue("{\"tankCapacityLiters\":50}",VehicleDtos.Create.class));
        assertEquals("35.5",mapper.readValue("{\"liters\":\"35.5\"}",FuelEntryDtos.Create.class).liters());
    }
    @Test void jacksonRejectsFractionalAndTextOdometers() {
        var mapper=JsonMapper.builder().build();
        assertThrows(Exception.class,()->mapper.readValue("{\"odometerKm\":1000.5}",FuelEntryDtos.Create.class));
        assertThrows(Exception.class,()->mapper.readValue("{\"odometerKm\":\"1000\"}",FuelEntryDtos.Create.class));
        assertEquals(1000L,mapper.readValue("{\"odometerKm\":1000}",FuelEntryDtos.Create.class).odometerKm());
    }
    @Test void ianaZoneRequired() {
        assertThrows(ApiException.class,()->DomainValues.zone("-03:00"));
        assertThrows(ApiException.class,()->DomainValues.zone("Invalid/Zone"));
        assertEquals(ZoneId.of("America/Sao_Paulo"),DomainValues.zone("America/Sao_Paulo"));
    }
    private FuelEntryRepository repository;
    private VehicleService vehicles;
    private Vehicle vehicle;
    private FuelEntryService service;
    @BeforeEach void setup() {
        repository=mock(FuelEntryRepository.class); vehicles=mock(VehicleService.class); vehicle=mock(Vehicle.class);
        when(vehicles.lockOwned(vehicleId)).thenReturn(vehicle);
        when(vehicle.allowedFuels()).thenReturn(Set.of(FuelType.GASOLINE_REGULAR));
        service=new FuelEntryService(repository,vehicles,Clock.fixed(now,ZoneOffset.UTC));
        when(repository.saveAndFlush(any())).thenAnswer(i->i.getArgument(0));
    }
    @Test void replayReturnsCurrentStateBeforeArchiveAndFutureChecks() {
        var input=command("40","6","240",null);
        FuelEntry existing=new FuelEntry(FuelCommand.normalize(vehicleId,input),false);
        setField(existing,"notes","edited later");setField(existing,"paidTotal",new BigDecimal("230"));setField(existing,"version",8L);
        when(repository.findById(entryId)).thenReturn(Optional.of(existing));
        when(vehicle.archivedAt()).thenReturn(now);
        var result=service.create(vehicleId,input);
        assertTrue(result.idempotentReplay()); assertEquals(8L,result.version()); assertEquals("edited later",result.notes());
        assertEquals("230",result.paidTotal()); verify(repository,never()).saveAndFlush(any());
        verify(vehicles).lockOwned(vehicleId);
    }
    @Test void changedReplayConflicts() {
        var existing=new FuelEntry(FuelCommand.normalize(vehicleId,command("40","6","240",null)),false);
        when(repository.findById(entryId)).thenReturn(Optional.of(existing));
        var error=assertThrows(ApiException.class,()->service.create(vehicleId,command("41","6","246",null)));
        assertEquals(409,error.status());
    }
    private FuelEntryDtos.Create location(FuelEntryDtos.Create c, BigDecimal latitude, BigDecimal longitude) {
        return new FuelEntryDtos.Create(c.id(),c.occurredAt(),c.timezone(),c.odometerKm(),c.fuelType(),
            c.liters(),c.unitPrice(),c.paidTotal(),c.tankState(),c.historyGapBefore(),c.adjustmentReason(),c.stationName(),c.notes(),latitude,longitude);
    }
    @Test void locationDefaultsAndFingerprintKeepTheOriginalSnapshot() {
        var input=command("40","6","240",null);
        var minimal=new FuelEntryDtos.Create(input.id(),input.occurredAt(),input.timezone(),input.odometerKm(),input.fuelType(),
            input.liters(),input.unitPrice(),input.paidTotal(),null,null,null,null,null,BigDecimal.ZERO,BigDecimal.ZERO);
        var saved=service.create(vehicleId,minimal);
        assertEquals(TankState.UNKNOWN,saved.tankState()); assertFalse(saved.historyGapBefore());
        assertEquals(BigDecimal.ZERO,saved.latitude()); assertEquals(BigDecimal.ZERO,saved.longitude());
        assertEquals(FuelCommand.normalize(vehicleId,location(input,BigDecimal.ZERO,new BigDecimal("1.0"))).hash(),
            FuelCommand.normalize(vehicleId,location(input,new BigDecimal("-0.000"),new BigDecimal("1.000"))).hash());
        var existing=new FuelEntry(FuelCommand.normalize(vehicleId,input),false);
        when(repository.findById(entryId)).thenReturn(Optional.of(existing));
        var equivalent=location(input,new BigDecimal("-23.550520"),new BigDecimal("-46.6333080"));
        assertTrue(service.create(vehicleId,equivalent).idempotentReplay());
        var changed=location(input,new BigDecimal("-23.5505201"),input.longitude());
        assertEquals(409,assertThrows(ApiException.class,()->service.create(vehicleId,changed)).status());
        assertEquals(409,assertThrows(ApiException.class,()->service.create(vehicleId,location(input,null,null))).status());
        assertEquals(input.latitude().stripTrailingZeros(),((BigDecimal) getField(existing,"latitude")));
    }
    @Test void newEntryCannotOmitLocationButPreGpsFingerprintStillReplays() {
        var input=location(command("40","6","240",null),null,null);
        assertEquals(422,assertThrows(ApiException.class,()->service.create(vehicleId,input)).status());
        verify(repository,never()).saveAndFlush(any());
        var fixed=new FuelEntryDtos.Create(UUID.fromString("11111111-1111-1111-1111-111111111111"),
            now.atOffset(ZoneOffset.UTC),"America/Sao_Paulo",1000L,FuelType.GASOLINE_REGULAR,"40","6","240",
            TankState.FULL,false,null,"Posto",null,null,null);
        var legacyCommand=FuelCommand.normalize(UUID.fromString("22222222-2222-2222-2222-222222222222"),fixed);
        assertEquals("8f1a53b85535c16797b7950e4fa87947eec2e35738c5c5fa51d176bfcd11d46c",legacyCommand.hash());
        var legacy=new FuelEntry(FuelCommand.normalize(vehicleId,input),false);
        when(repository.findById(entryId)).thenReturn(Optional.of(legacy));
        when(vehicle.archivedAt()).thenReturn(now);
        var replay=service.create(vehicleId,input);
        assertTrue(replay.idempotentReplay()); assertNull(replay.latitude()); assertNull(replay.longitude());
        assertEquals(409,assertThrows(ApiException.class,()->service.create(vehicleId,command("40","6","240",null))).status());
    }
    @Test void locationPairRangeAndPrecisionAreValidatedWithoutRounding() {
        var input=command("40","6","240",null);
        for (String[] pair:List.of(new String[]{"90","180"},new String[]{"-90","-180"},new String[]{"0","0"})) {
            assertDoesNotThrow(()->service.create(vehicleId,location(input,new BigDecimal(pair[0]),new BigDecimal(pair[1]))));
        }
        for (String[] pair:List.of(new String[]{"90.0000001","0"},new String[]{"-90.0000001","0"},
                new String[]{"0","180.0000001"},new String[]{"0","-180.0000001"},new String[]{"0.00000001","0"})) {
            assertEquals(422,assertThrows(ApiException.class,()->service.create(vehicleId,
                location(input,new BigDecimal(pair[0]),new BigDecimal(pair[1])))).status());
        }
        assertEquals(422,assertThrows(ApiException.class,()->service.create(vehicleId,location(input,null,BigDecimal.ZERO))).status());
        assertEquals(422,assertThrows(ApiException.class,()->service.create(vehicleId,location(input,BigDecimal.ZERO,null))).status());
    }
    @Test void retroactiveOdometerMustFitBothNeighbors() {
        var previous=new FuelEntry();setField(previous,"odometerKm",900);
        var next=new FuelEntry();setField(next,"odometerKm",1100);
        when(repository.findFirstByVehicleIdAndOccurredAtLessThanOrderByOccurredAtDescIdDesc(vehicleId,now)).thenReturn(Optional.of(previous));
        when(repository.findFirstByVehicleIdAndOccurredAtGreaterThanOrderByOccurredAtAscIdAsc(vehicleId,now)).thenReturn(Optional.of(next));
        assertDoesNotThrow(()->service.create(vehicleId,command("40","6","240",null)));
        setField(previous,"odometerKm",1001);
        assertThrows(ApiException.class,()->service.create(vehicleId,command("40","6","240",null)));
        setField(previous,"odometerKm",1000);setField(next,"odometerKm",999);
        assertThrows(ApiException.class,()->service.create(vehicleId,command("40","6","240",null)));
        setField(next,"odometerKm",1000);
        assertDoesNotThrow(()->service.create(vehicleId,command("40","6","240",null)));
    }
    @Test void tiedFullTankRequiresTimeCorrectionButEqualPartialReadingsAreAllowed() {
        var same=new FuelEntry();setField(same,"odometerKm",1000);setField(same,"tankState",TankState.FULL);
        when(repository.findByVehicleIdAndOccurredAt(vehicleId,now)).thenReturn(List.of(same));
        var error=assertThrows(ApiException.class,()->service.create(vehicleId,command("40","6","240",null)));
        assertTrue(error.fieldErrors().containsKey("occurredAt"));
        setField(same,"tankState",TankState.PARTIAL);
        assertDoesNotThrow(()->service.create(vehicleId,command("40","6","240",null)));
    }
    @Test void archiveAndDisallowedFuelAreRejected() {
        when(vehicle.archivedAt()).thenReturn(now);
        assertEquals(409,assertThrows(ApiException.class,()->service.create(vehicleId,command("40","6","240",null))).status());
        when(vehicle.archivedAt()).thenReturn(null);when(vehicle.allowedFuels()).thenReturn(Set.of(FuelType.ETHANOL));
        assertEquals(422,assertThrows(ApiException.class,()->service.create(vehicleId,command("40","6","240",null))).status());
    }
    @Test void crossVehicleUuidRaceBecomesConflictAndOtherIntegrityFailuresRemainErrors() {
        when(repository.saveAndFlush(any())).thenThrow(new org.springframework.dao.DataIntegrityViolationException("duplicate",
            new java.sql.SQLException("duplicate", "23505")));
        assertEquals(409,assertThrows(ApiException.class,()->service.create(vehicleId,command("40","6","240",null))).status());
        doThrow(new org.springframework.dao.DataIntegrityViolationException("check",
            new java.sql.SQLException("check", "23514"))).when(repository).saveAndFlush(any());
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class,()->service.create(vehicleId,command("40","6","240",null)));
    }
    @Test void pendingGapIsConsumedOnlyAtOrAfterItsBoundary() {
        when(vehicle.pendingHistoryGapAfter()).thenReturn(now.plusSeconds(1));
        assertFalse(service.create(vehicleId,command("40","6","240",null)).historyGapBefore());
        verify(vehicle,never()).consumePendingGap();
        when(vehicle.pendingHistoryGapAfter()).thenReturn(now);
        assertTrue(service.create(vehicleId,command("40","6","240",null)).historyGapBefore());
        verify(vehicle).consumePendingGap();
    }
    @Test void futureToleranceIncludesFiveMinutes() {
        service=new FuelEntryService(repository,vehicles,Clock.fixed(now.minusSeconds(300),ZoneOffset.UTC));
        assertDoesNotThrow(()->service.create(vehicleId,command("40","6","240",null)));
        service=new FuelEntryService(repository,vehicles,Clock.fixed(now.minusSeconds(301),ZoneOffset.UTC));
        assertTrue(assertThrows(ApiException.class,()->service.create(vehicleId,command("40","6","240",null))).fieldErrors().containsKey("occurredAt"));
    }
}
