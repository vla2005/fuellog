package com.fuellog.vehicles;

import com.fuellog.identity.CurrentUserService;
import com.fuellog.platform.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;

@Service
public class VehicleService {
    private final VehicleRepository vehicles;
    private final CurrentUserService currentUser;
    public VehicleService(VehicleRepository vehicles, CurrentUserService currentUser) { this.vehicles=vehicles; this.currentUser=currentUser; }
    @Transactional(readOnly=true)
    public List<VehicleDtos.View> list() {
        return vehicles.findByUserIdOrderByCreatedAtAscIdAsc(currentUser.requireUserId()).stream().map(Vehicle::view).toList();
    }
    @Transactional(readOnly=true)
    public VehicleDtos.View get(UUID id) { return owned(id).view(); }
    @Transactional
    public VehicleDtos.View create(VehicleDtos.Create command) {
        UUID owner=currentUser.requireUserId();
        return vehicles.saveAndFlush(new Vehicle(owner,command.normalized())).view();
    }
    public Vehicle owned(UUID id) { return vehicles.findByIdAndUserId(id,currentUser.requireUserId()).orElseThrow(VehicleService::notFound); }
    public Vehicle lockOwned(UUID id) { return vehicles.lockOwned(id,currentUser.requireUserId()).orElseThrow(VehicleService::notFound); }
    public static ApiException notFound() { return new ApiException(404,"RESOURCE_NOT_FOUND","Recurso n\u00e3o encontrado."); }
}
