package com.fuellog.metrics.controllers;

import com.fuellog.metrics.dtos.MetricsDtos;
import com.fuellog.metrics.services.MetricsService;
import com.fuellog.vehicles.enums.FuelType;

import org.springframework.web.bind.annotation.*;
import java.time.LocalDate;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/vehicles/{vehicleId}")
public class MetricsController {
    private final MetricsService metrics;
    public MetricsController(MetricsService metrics) { this.metrics=metrics; }
    @GetMapping("/dashboard")
    public MetricsDtos.Dashboard dashboard(@PathVariable UUID vehicleId,
        @RequestParam(required=false) LocalDate from, @RequestParam(required=false) LocalDate to,
        @RequestParam(defaultValue="America/Sao_Paulo") String timezone,
        @RequestParam(required=false) FuelType fuelType) {
        return metrics.dashboard(vehicleId,from,to,timezone,fuelType);
    }
    @GetMapping("/summary")
    public MetricsDtos.Summary summary(@PathVariable UUID vehicleId,
        @RequestParam(required=false) LocalDate from, @RequestParam(required=false) LocalDate to,
        @RequestParam(defaultValue="America/Sao_Paulo") String timezone) {
        return metrics.summary(vehicleId,from,to,timezone);
    }
}
