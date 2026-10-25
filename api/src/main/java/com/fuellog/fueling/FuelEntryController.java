package com.fuellog.fueling;

import com.fuellog.vehicles.FuelType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.net.URI;
import java.time.LocalDate;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/vehicles/{vehicleId}/fuel-entries")
public class FuelEntryController {
    private final FuelEntryService entries;
    public FuelEntryController(FuelEntryService entries) { this.entries=entries; }
    @PostMapping public ResponseEntity<FuelEntryDtos.View> create(@PathVariable UUID vehicleId, @RequestBody FuelEntryDtos.Create command) {
        var view=entries.create(vehicleId,command);
        return ResponseEntity.status(view.idempotentReplay() ? 200 : 201)
            .header("Location",URI.create("/api/v1/vehicles/"+vehicleId+"/fuel-entries/"+view.id()).toString())
            .eTag("\""+view.version()+"\"").body(view);
    }
    @GetMapping("/{entryId}") public ResponseEntity<FuelEntryDtos.View> get(@PathVariable UUID vehicleId, @PathVariable UUID entryId) {
        var view=entries.get(vehicleId,entryId); return ResponseEntity.ok().eTag("\""+view.version()+"\"").body(view);
    }
    @GetMapping public FuelEntryDtos.Page list(@PathVariable UUID vehicleId,
        @RequestParam(required=false) LocalDate from, @RequestParam(required=false) LocalDate to,
        @RequestParam(defaultValue="America/Sao_Paulo") String timezone,
        @RequestParam(required=false) FuelType fuelType, @RequestParam(required=false) TankState tankState,
        @RequestParam(defaultValue="0") int page, @RequestParam(defaultValue="30") int size) {
        return entries.list(vehicleId,from,to,timezone,fuelType,tankState,page,size);
    }
}
