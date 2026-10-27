package com.fuellog.vehicles;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.net.URI;
import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class VehicleController {
    private final VehicleService vehicles;
    public VehicleController(VehicleService vehicles) { this.vehicles=vehicles; }
    @GetMapping("/fuel-types") public List<FuelType> fuelTypes() { return List.of(FuelType.values()); }
    @GetMapping("/vehicles") public List<VehicleDtos.View> list() { return vehicles.list(); }
    @GetMapping("/vehicles/{vehicleId}") public ResponseEntity<VehicleDtos.View> get(@PathVariable UUID vehicleId) {
        var view=vehicles.get(vehicleId); return ResponseEntity.ok().eTag("\""+view.version()+"\"").body(view);
    }
    @PostMapping("/vehicles") public ResponseEntity<VehicleDtos.View> create(@RequestBody VehicleDtos.Create command) {
        var view=vehicles.create(command);
        return ResponseEntity.created(URI.create("/api/v1/vehicles/"+view.id())).eTag("\""+view.version()+"\"").body(view);
    }
    @PutMapping("/vehicles/{vehicleId}") public ResponseEntity<VehicleDtos.View> update(@PathVariable UUID vehicleId,
        @RequestHeader(name="If-Match",required=false) String ifMatch, @RequestBody VehicleDtos.Update command) {
        var view=vehicles.update(vehicleId,ifMatch,command);
        return ResponseEntity.ok().eTag("\""+view.version()+"\"").body(view);
    }
}
