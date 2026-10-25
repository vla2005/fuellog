package com.fuellog.vehicles;

import com.fuellog.identity.CurrentUserService;
import com.fuellog.platform.ApiException;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class VehicleServiceTest {
    @Test void createNormalizesAndRequiresAllowedFuelWithoutTrustingClientOwner() {
        var repository=mock(VehicleRepository.class);
        var current=mock(CurrentUserService.class);
        UUID owner=UUID.randomUUID();when(current.requireUserId()).thenReturn(owner);
        when(repository.saveAndFlush(any())).thenAnswer(i->i.getArgument(0));
        var service=new VehicleService(repository,current);
        var result=service.create(new VehicleDtos.Create("  Carro  ","  ",null,2020,null,"50.123",Set.of(FuelType.ETHANOL)));
        assertEquals("Carro",result.nickname());assertNull(result.brand());assertEquals("50.123",result.tankCapacityLiters());
        assertEquals(Set.of(FuelType.ETHANOL),result.allowedFuels());verify(current).requireUserId();
        assertThrows(ApiException.class,()->service.create(new VehicleDtos.Create("Carro",null,null,null,null,null,Set.of())));
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
