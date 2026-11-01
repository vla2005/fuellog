package com.fuellog.vikash.controllers;

import com.fuellog.vikash.dtos.ViKashDtos.*;
import com.fuellog.vikash.services.ViKashService;
import java.net.URI;
import java.util.UUID;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/integrations/vikash")
public class ViKashController {
    private final ViKashService service;
    public ViKashController(ViKashService service) { this.service=service; }
    private static <T> ResponseEntity<T> response(T value) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value); }
    @GetMapping public ResponseEntity<Status> status() { return response(service.status()); }
    @PostMapping("/authorizations") public ResponseEntity<Authorization> start(@RequestBody Start input) { return response(service.start(input)); }
    @DeleteMapping("/authorizations") public ResponseEntity<Void> cancel() { service.cancelAuthorization(); return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build(); }
    @GetMapping("/callback") public ResponseEntity<Void> callback(@RequestParam(required=false) String state,@RequestParam(required=false) String code,@RequestParam(required=false) String error) {
        return ResponseEntity.status(303).location(URI.create(service.callback(state,code,error))).cacheControl(CacheControl.noStore()).header("Referrer-Policy","no-referrer").build();
    }
    @GetMapping("/catalog") public ResponseEntity<Catalog> catalog() { return response(service.catalog()); }
    @PutMapping("/preferences") public ResponseEntity<Preferences> preferences(@RequestBody Preferences input) { return response(service.preferences(input)); }
    @DeleteMapping public ResponseEntity<Disconnect> disconnect() { return response(service.disconnect()); }
    @GetMapping("/deletions") public ResponseEntity<Deletions> deletions(@RequestParam(defaultValue="0") int page) { return response(service.deletions(page)); }
    @GetMapping("/entries/{entryId}/remote") public ResponseEntity<RemoteStatus> remote(@PathVariable UUID entryId) { return response(service.remoteStatus(entryId)); }
    @PostMapping("/entries/{entryId}/retry") public ResponseEntity<Void> retry(@PathVariable UUID entryId,@RequestBody Retry input) {
        service.retry(entryId,input); return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
}
