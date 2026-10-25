package com.fuellog.metrics;

import org.springframework.web.bind.annotation.*;
import java.time.LocalDate;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/vehicles/{vehicleId}")
public class MetricsController {
    private final MetricsService metrics;
    public MetricsController(MetricsService metrics) { this.metrics=metrics; }
    @GetMapping("/summary")
    public MetricsDtos.Summary summary(@PathVariable UUID vehicleId,
        @RequestParam(required=false) LocalDate from, @RequestParam(required=false) LocalDate to,
        @RequestParam(defaultValue="America/Sao_Paulo") String timezone) {
        return metrics.summary(vehicleId,from,to,timezone);
    }
    @GetMapping("/consumption-cycles")
    public MetricsDtos.Cycles cycles(@PathVariable UUID vehicleId,
        @RequestParam(required=false) LocalDate from, @RequestParam(required=false) LocalDate to,
        @RequestParam(defaultValue="America/Sao_Paulo") String timezone) {
        return metrics.cycles(vehicleId,from,to,timezone);
    }
}
