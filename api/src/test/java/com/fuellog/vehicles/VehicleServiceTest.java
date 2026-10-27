package com.fuellog.vehicles;

import com.fuellog.identity.CurrentUserService;
import com.fuellog.platform.ApiException;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class VehicleServiceTest {
    @Test void updatesNormalizeOnlyTheEditableFieldsAndValidateBoundaries() {
        var vehicle=new Vehicle(UUID.randomUUID(),new VehicleDtos.Create("Old","Brand","Old model",2020,"ABC1D23","40",Set.of(FuelType.ETHANOL),50L));
        var command=new VehicleDtos.Update("  New model  ",Set.of(FuelType.GASOLINE_REGULAR),9007199254740991L,"50.123").normalized();
        vehicle.update(command);
        var result=vehicle.view();
        assertEquals("New model",result.model()); assertEquals(result.model(),result.nickname());
        assertEquals("Brand",result.brand()); assertEquals(2020,result.modelYear()); assertEquals("ABC1D23",result.plate());
        assertEquals("50.123",result.tankCapacityLiters()); assertEquals(9007199254740991L,result.currentOdometerKm());
        for (String model : new String[]{null," ","a".repeat(61)})
            assertField("model",()->new VehicleDtos.Update(model,Set.of(FuelType.ETHANOL),null,null).normalized());
        for (Set<FuelType> fuels : Arrays.asList(null,Set.<FuelType>of(),new HashSet<>(Arrays.asList(FuelType.ETHANOL,null))))
            assertField("allowedFuels",()->new VehicleDtos.Update("Car",fuels,null,null).normalized());
        for (long reading : new long[]{-1,9007199254740992L,Long.MAX_VALUE})
            assertField("currentOdometerKm",()->new VehicleDtos.Update("Car",Set.of(FuelType.ETHANOL),reading,null).normalized());
        for (String capacity : List.of("0","-1","50,1","50.1234","100000"))
            assertField("tankCapacityLiters",()->new VehicleDtos.Update("Car",Set.of(FuelType.ETHANOL),null,capacity).normalized());
        assertEquals(0L,new VehicleDtos.Update("Car",Set.of(FuelType.ETHANOL),0L,"99999.999").normalized().currentOdometerKm());
    }
    @Test void preconditionsRequireOneStrongNonnegativeInt64Tag() {
        assertEquals(0,VehicleService.expectedVersion("\"0\""));
        assertEquals(Long.MAX_VALUE,VehicleService.expectedVersion(" \"9223372036854775807\" "));
        assertEquals(428,assertThrows(ApiException.class,()->VehicleService.expectedVersion(null)).status());
        for (String value : List.of("","0","*","W/\"0\"","\"-1\"","\"01\"","\"1.0\"","\"0\", \"1\"","\"9223372036854775808\""))
            assertEquals(400,assertThrows(ApiException.class,()->VehicleService.expectedVersion(value)).status());
    }
    private void assertField(String field, org.junit.jupiter.api.function.Executable action) {
        var error=assertThrows(ApiException.class,action);
        assertEquals(422,error.status()); assertTrue(error.fieldErrors().containsKey(field));
    }
    @Test void createNormalizesAndRequiresAllowedFuelWithoutTrustingClientOwner() {
        var repository=mock(VehicleRepository.class);
        var current=mock(CurrentUserService.class);
        UUID owner=UUID.randomUUID();when(current.requireUserId()).thenReturn(owner);
        when(repository.saveAndFlush(any())).thenAnswer(i->i.getArgument(0));
        var service=new VehicleService(repository,current);
        var result=service.create(new VehicleDtos.Create("  Carro  ","  ",null,2020,null,"50.123",Set.of(FuelType.ETHANOL),12345L));
        assertEquals("Carro",result.nickname());assertNull(result.brand());assertEquals("50.123",result.tankCapacityLiters());
        assertEquals(12345L,result.currentOdometerKm());assertEquals(Set.of(FuelType.ETHANOL),result.allowedFuels());verify(current).requireUserId();
        assertThrows(ApiException.class,()->service.create(new VehicleDtos.Create("Carro",null,null,null,null,null,Set.of(),null)));
    }
    @Test void bothReadsAndLocksAreOwnerScopedAndForeignVehiclesAreNotFound() {
        var repository=mock(VehicleRepository.class);var current=mock(CurrentUserService.class);
        UUID owner=UUID.randomUUID(),id=UUID.randomUUID();when(current.requireUserId()).thenReturn(owner);
        var service=new VehicleService(repository,current);
        var error=assertThrows(ApiException.class,()->service.get(id));
        assertEquals(404,error.status());assertEquals("RESOURCE_NOT_FOUND",error.code());
        assertEquals(404,assertThrows(ApiException.class,()->service.lockOwned(id)).status());
        verify(repository).findByIdAndUserId(id,owner);verify(repository).lockOwned(id,owner);
    }
}
