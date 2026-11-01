package com.fuellog.fueling.controllers;

import com.fuellog.fueling.dtos.FuelEntryDtos;
import com.fuellog.fueling.dtos.FuelEntryFilters;
import com.fuellog.fueling.services.FuelEntryService;
import com.fuellog.platform.exceptions.ApiException;
import com.fuellog.vehicles.enums.FuelType;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.net.URI;
import java.time.LocalDate;
import java.time.Instant;
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
    @PutMapping("/{entryId}") public ResponseEntity<FuelEntryDtos.View> update(@PathVariable UUID vehicleId, @PathVariable UUID entryId,
        @RequestHeader(value="If-Match",required=false) String ifMatch, @RequestBody FuelEntryDtos.Update command) {
        var view=entries.update(vehicleId,entryId,ifMatch,command);
        return ResponseEntity.ok().eTag("\""+view.version()+"\"").body(view);
    }
    @DeleteMapping("/{entryId}") public ResponseEntity<Void> delete(@PathVariable UUID vehicleId, @PathVariable UUID entryId,
        @RequestHeader(value="If-Match",required=false) String ifMatch) {
        entries.delete(vehicleId,entryId,ifMatch);
        return ResponseEntity.noContent().build();
    }
    @GetMapping public FuelEntryDtos.Page list(@PathVariable UUID vehicleId,
        @RequestParam(required=false) LocalDate from, @RequestParam(required=false) LocalDate to,
        @RequestParam(defaultValue="America/Sao_Paulo") String timezone,
        @RequestParam(required=false) FuelType fuelType,
        @RequestParam(required=false) String minTotalPaid, @RequestParam(required=false) String maxTotalPaid,
        @RequestParam(required=false) String minLiters, @RequestParam(required=false) String maxLiters,
        @RequestParam(required=false) String minPricePerLiter, @RequestParam(required=false) String maxPricePerLiter,
        @RequestParam(required=false) Instant occurredFrom, @RequestParam(required=false) Instant occurredTo,
        @RequestParam(required=false) UUID entryId,
        @RequestParam(required=false) String page, @RequestParam(required=false) String size) {
        return entries.list(vehicleId,from,to,timezone,fuelType,
            FuelEntryFilters.parse(minTotalPaid,maxTotalPaid,minLiters,maxLiters,minPricePerLiter,maxPricePerLiter),
            paginationParameter(page,0),paginationParameter(size,20),occurredFrom,occurredTo,entryId);
    }
    private static int paginationParameter(String value, int defaultValue) {
        try { return value == null ? defaultValue : Integer.parseInt(value); }
        catch (NumberFormatException error) {
            throw new ApiException(400,"INVALID_PAGINATION","page >= 0 e size entre 1 e 20.");
        }
    }
}
