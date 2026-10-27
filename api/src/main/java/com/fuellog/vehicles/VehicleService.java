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
    @Transactional
    public VehicleDtos.View update(UUID id, String ifMatch, VehicleDtos.Update command) {
        Vehicle vehicle=lockOwned(id);
        long expected=expectedVersion(ifMatch);
        if (!Objects.equals(vehicle.view().version(),expected))
            throw new ApiException(412,"PRECONDITION_FAILED","Ve\u00edculo alterado; recarregue antes de salvar.");
        vehicle.update(command.normalized());
        vehicles.flush();
        return vehicle.view();
    }
    static long expectedVersion(String ifMatch) {
        if (ifMatch == null) throw new ApiException(428,"PRECONDITION_REQUIRED","Informe If-Match com a vers\u00e3o do ve\u00edculo.");
        String value=ifMatch.strip();
        if (value.matches("\"(0|[1-9][0-9]*)\"")) {
            try { return Long.parseLong(value.substring(1,value.length()-1)); }
            catch (NumberFormatException ignored) { }
        }
        throw new ApiException(400,"INVALID_IF_MATCH","If-Match deve conter uma \u00fanica ETag forte num\u00e9rica.");
    }
    public Vehicle owned(UUID id) { return vehicles.findByIdAndUserId(id,currentUser.requireUserId()).orElseThrow(VehicleService::notFound); }
    public Vehicle lockOwned(UUID id) { return vehicles.lockOwned(id,currentUser.requireUserId()).orElseThrow(VehicleService::notFound); }
    public static ApiException notFound() { return new ApiException(404,"RESOURCE_NOT_FOUND","Recurso n\u00e3o encontrado."); }
}
